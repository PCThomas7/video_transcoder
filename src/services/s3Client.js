import AWS from 'aws-sdk';

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    endpoint: process.env.WASABI_ENDPOINT || 's3.us-east-1.wasabisys.com', // Wasabi endpoint
    s3ForcePathStyle: true,
});

export const uploadFile = (file, bucketName) => {
    const params = {
        Bucket: bucketName,
        Key: `${Date.now()}-${file.originalname}`,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
    };

    return s3.upload(params).promise();
};

export const getFileUrl = (bucketName, key) => {
    const endpoint = process.env.WASABI_ENDPOINT || 's3.us-east-1.wasabisys.com';
    return `https://${bucketName}.${endpoint}/${key}`;
};