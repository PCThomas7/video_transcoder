import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';
import path from 'path';

// Determine if using Wasabi (has a wasabi endpoint) or AWS
const wasabiEndpoint = process.env.WASABI_ENDPOINT; // e.g., "s3.ap-southeast-1.wasabisys.com"

// S3 Client (AWS SDK v3)
const s3Client = new S3Client({
    // For Wasabi: use a standard region code, the actual region is in the endpoint
    region: process.env.AWS_REGION || 'us-east-1',
    // Endpoint must be a full URL for Wasabi
    endpoint: wasabiEndpoint ? `https://${wasabiEndpoint}` : undefined,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    forcePathStyle: true // Required for Wasabi and S3-compatible storage
});

// Multer-S3 storage configuration - streams directly to S3
const s3Storage = multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
        // Generate unique key: raw-videos/{uuid}-{originalname}
        const uniqueId = uuid();
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        const key = `raw-videos/${uniqueId}-${baseName}${ext}`;

        // Store the key and uuid in request for later use
        req.videoKey = key;
        req.videoId = uniqueId;

        cb(null, key);
    },
    metadata: (req, file, cb) => {
        cb(null, {
            originalname: file.originalname,
            mimetype: file.mimetype
        });
    }
});

// File filter to only accept video files
const videoFileFilter = (req, file, cb) => {
    const allowedMimes = [
        'video/mp4',
        'video/mpeg',
        'video/quicktime',
        'video/x-msvideo',
        'video/x-matroska',
        'video/webm'
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type. Allowed types: ${allowedMimes.join(', ')}`), false);
    }
};

// Multer upload middleware with S3 streaming
const uploadToS3 = multer({
    storage: s3Storage,
    fileFilter: videoFileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024 // 5GB max file size
    }
});

export { s3Client };
export default uploadToS3;
