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
    const firstName = userEmail.split('.')[0].charAt(0).toUpperCase() + userEmail.split('.')[0].slice(1);
    const assignmentId = snsMessage.assignmentId;
    const userId = snsMessage.userId;

    const decodedPrivateKey = Buffer.from(
        process.env.GCP_PRIVATE_KEY,
        "base64"
      ).toString("utf-8");
    const keyFileJson = JSON.parse(decodedPrivateKey);
    const storage = new Storage({ 
      projectId: process.env.GCP_PROJECT_NAME,
      credentials: keyFileJson,
    });

    try {
        const response = await axios.get(submissionUrl, { responseType: 'arraybuffer' });
        const zipBuffer = Buffer.from(response.data);

        const originalFileName = path.basename(submissionUrl);

        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '');
        const fileName = `${userId}/${assignmentId}/${originalFileName.replace('.zip', '')}-${timestamp}.zip`;

        await storage.bucket(bucketName).file(fileName).save(zipBuffer);

        console.log(`File ${fileName} uploaded to ${bucketName}.`);

        console.log(`Zip contents uploaded successfully.`);
        subject = 'Assignment submitted successfully';
        await sendEmail(`Hi ${firstName},\nThe assignment has been downloaded and saved in GCP bucket successfully.\nPlease find below the path to the assignment.\n\n${fileName}\n\n\nThank you,\nwebapp`, userEmail);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Zip file uploaded successfully.` }),
        };
    } catch (error) {
        console.error('Error uploading zip contents:', error);
        subject = 'Assignment not submitted successfully';
        await sendEmail(`Hi ${firstName},\nError occured while downloading or saving the assignment file.\nPlease find below the error details.\n ${error.message}\n\n\nThank you,\nwebapp`, userEmail);
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
                    Data: statusMessage,
                },
            },
            Subject: {
                Data: `${subject}`,
            },
        },
        Source: process.env.SES_SENDER_MAIL_ID,
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