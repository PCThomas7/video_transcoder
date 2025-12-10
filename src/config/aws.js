import AWS from 'aws-sdk';

const s3Config = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    endpoint: process.env.WASABI_ENDPOINT || 's3.us-east-1.wasabisys.com', // Wasabi endpoint
    s3ForcePathStyle: true,
};

console.log('S3 Config:', s3Config); // Debugging line to check config values

AWS.config.update(s3Config);

const s3 = new AWS.S3();

/**
 * Generate a pre-signed URL for accessing private S3 objects
 * @param {string} key - The S3 object key
 * @param {number} expiresIn - URL expiration time in seconds (default: 24 hours)
 * @returns {string} Pre-signed URL
 */
export const getSignedUrl = (key, expiresIn = 86400) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
        Expires: expiresIn, // URL expires in this many seconds
    };
    return s3.getSignedUrl('getObject', params);
};

export default s3;