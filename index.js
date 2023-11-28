const AWS = require('aws-sdk');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');
const ses = new AWS.SES();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const path = require('path');
let subject;

exports.handler = async (event, context) => {
    const bucketName = process.env.GCP_BUCKET_NAME;
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    
    const submissionUrl = snsMessage.submissionUrl;
    const userEmail = snsMessage.userEmail;

    const decodedPrivateKey = Buffer.from(
        process.env.GCP_PRIVATE_KEY,
        "base64"
      ).toString("utf-8");
    const keyFileJson = JSON.parse(decodedPrivateKey);
    const storage = new Storage({ 
      projectId: 'mydev-405504',
      credentials: keyFileJson,
    });

    try {
        const response = await axios.get(submissionUrl, { responseType: 'arraybuffer' });
        const zipBuffer = Buffer.from(response.data);

        const originalFileName = path.basename(submissionUrl);

        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '');
        const fileName = `${originalFileName.replace('.zip', '')}-${timestamp}.zip`;

        await storage.bucket(bucketName).file(fileName).save(zipBuffer);

        console.log(`File ${fileName} uploaded to ${bucketName}.`);

        console.log(`Zip contents uploaded successfully.`);
        subject = 'Success';
        await sendEmail('Zip file has been downloaded and saved successfully.', userEmail);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Zip file uploaded successfully.` }),
        };
    } catch (error) {
        console.error('Error uploading zip contents:', error);
        subject = 'Failure';
        await sendEmail('Error occured while downloading or saving zip file.', userEmail);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        };
    }
   
};

async function sendEmail(statusMessage, mailid) {
    const emailParams = {
        Destination: {
            ToAddresses: [mailid],
        },
        Message: {
            Body: {
                Text: {
                    Data: `Status: ${statusMessage}`,
                },
            },
            Subject: {
                Data: `${subject}`,
            },
        },
        Source: 'notification@demo.mywebapp.me',
    };

    try {
        const emailResult = await ses.sendEmail(emailParams).promise();
        const dynamoParams = {
            TableName: process.env.DYNAMO_DB_NAME,
            Item: {
                EmailId: 'Sent-' + Date.now(),
                Status: 'Sent',
                EmailBody: emailParams.Message.Body.Text.Data,
                ReceiverEmail: mailid,
            },
        }
        await dynamoDB.put(dynamoParams).promise();
        console.log('Email sent:', emailResult);
    } catch (error) {
        console.error('Error sending email:', error);
        const dynamoErrorParams = {
            TableName: process.env.DYNAMO_DB_NAME,
            Item: {
                EmailId: 'Error-' + Date.now(),
                Status: 'Error',
                EmailBody: emailParams.Message.Body.Text.Data,
                ReceiverEmail: mailid,
            },
        };
        await dynamoDB.put(dynamoErrorParams).promise();
    }
}