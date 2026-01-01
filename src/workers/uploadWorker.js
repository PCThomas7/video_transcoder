import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import LessonTranscode from '../models/LessonTranscode.js';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const wasabiEndpoint = process.env.WASABI_ENDPOINT || 'https://s3.ap-south-1.wasabisys.com';
const BUCKET = process.env.WASABI_BUCKET;

const s3 = new S3Client({
    region: process.env.WASABI_REGION || 'ap-south-1',
    endpoint: wasabiEndpoint.startsWith('http') ? wasabiEndpoint : `https://${wasabiEndpoint}`,
    credentials: {
        accessKeyId: process.env.WASABI_KEY,
        secretAccessKey: process.env.WASABI_SECRET,
    },
    forcePathStyle: true,
});

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null
});

// Helper: Generate pre-signed URL
const generatePresignedUrl = async (key, expiresIn = 86400) => {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return await getSignedUrl(s3, command, { expiresIn });
};

async function uploadToWasabi(localFilePath, key) {
    console.log(`[UploadWorker] Uploading ${localFilePath} to wasabi...`);
    const body = fs.createReadStream(localFilePath);
    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: body,
            ContentType: localFilePath.toLowerCase().endsWith(".mp4")
                ? "video/mp4"
                : "video/MP2T",
        })
    );
    return { bucket: BUCKET, key };
}

const processUpload = async (job) => {
    const { localVideo, key, lessonId, courseId, streamName, jobId } = job.data;
    console.log(`[UploadWorker] Processing upload for job ${jobId}, lesson: ${lessonId}`);

    try {
        // 1. Upload to S3
        const s3ref = await uploadToWasabi(localVideo, key);
        console.log(`[UploadWorker] Upload complete: ${key}`);

        // 2. Update Lesson model with raw URL
        const presignedVideoUrl = await generatePresignedUrl(key, 7 * 24 * 60 * 60);
        await LessonTranscode.findOneAndUpdate(
            { lessonId },
            {
                videoUrl: presignedVideoUrl,
                rawVideoKey: key,
                transcodingStatus: 'pending'
            },
            { upsert: true }
        );

        // 3. Notify backend
        try {
            await axios.post(`${process.env.BACKEND_URL}/api/lessons/webhook/update-video`, {
                lessonId,
                videoUrl: presignedVideoUrl,
                SECRET_KEY: process.env.SECRET_KEY
            });
        } catch (err) {
            console.error("[UploadWorker] Webhook failed:", err.message);
        }

        // 4. Enqueue to Fast Lane Transcode
        const transcodeQueue = new Queue('transcode-fast', { connection: redisConnection });
        await transcodeQueue.add('transcode-fast', {
            ...job.data,
            transcodeType: 'fast',
            input: s3ref,
            localFilePath: localVideo
        });
        await transcodeQueue.close();

        console.log(`[UploadWorker] Job ${jobId} successfully moved to transcode queue`);
        return { success: true, key };

    } catch (error) {
        console.error(`[UploadWorker] Job ${jobId} failed:`, error.message);
        throw error;
    }
};

const startWorker = async () => {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/video-transcoder';
    await mongoose.connect(mongoURI);
    console.log('[UploadWorker] MongoDB connected');

    const worker = new Worker('upload-queue', processUpload, {
        connection: redisConnection,
        concurrency: parseInt(process.env.UPLOAD_WORKER_CONCURRENCY) || 5
    });

    worker.on('completed', (job) => console.log(`[UploadWorker] ✓ Job ${job.id} uploaded`));
    worker.on('failed', (job, err) => console.error(`[UploadWorker] ✗ Job ${job.id} failed: ${err.message}`));

    process.on('SIGTERM', async () => {
        await worker.close();
        await redisConnection.quit();
        await mongoose.disconnect();
        process.exit(0);
    });
};

startWorker().catch(console.error);
