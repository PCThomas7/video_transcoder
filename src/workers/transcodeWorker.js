import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { transcodeVideo } from '../utils/ffmpeg.js';
import Job from '../models/Job.js';

// Load environment variables (for standalone worker process)
const loadEnv = async () => {
    try {
        const envPath = path.resolve(process.cwd(), '.env');
        const envContent = await fs.readFile(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                process.env[key.trim()] = valueParts.join('=').trim();
            }
        });
    } catch (err) {
        console.log('No .env file found, using existing environment variables');
    }
};

// S3 Client configuration
const createS3Client = () => new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.WASABI_ENDPOINT ? `https://${process.env.WASABI_ENDPOINT}` : undefined,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
});

// Content type helper
const getContentType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.m3u8') return 'application/vnd.apple.mpegurl';
    if (ext === '.ts') return 'video/MP2T';
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    return 'application/octet-stream';
};

// Download file from S3 to local temp directory
const downloadFromS3 = async (s3Client, bucket, key, localPath) => {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);
    const chunks = [];
    for await (const chunk of response.Body) {
        chunks.push(chunk);
    }
    await fs.writeFile(localPath, Buffer.concat(chunks));
};

// Upload folder to S3 recursively
const uploadFolderToS3 = async (s3Client, bucket, localDir, s3Prefix) => {
    const entries = await fs.readdir(localDir, { withFileTypes: true });
    for (const entry of entries) {
        const localPath = path.join(localDir, entry.name);
        const key = `${s3Prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            await uploadFolderToS3(s3Client, bucket, localPath, key);
        } else {
            const body = await fs.readFile(localPath);
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: getContentType(localPath)
            });
            await s3Client.send(command);
        }
    }
};

// Process a single transcode job
const processJob = async (job) => {
    const { jobId, rawVideoKey, originalFileName } = job.data;
    let tempDir = null;
    let tempVideoPath = null;

    console.log(`[Worker] Processing job ${jobId}`);

    const s3Client = createS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME;

    try {
        // Update job status to processing
        await Job.findOneAndUpdate(
            { jobId },
            { status: 'processing', startedAt: new Date() }
        );

        // Create temp directory
        tempDir = path.join(os.tmpdir(), `transcode-${uuid()}`);
        await fs.mkdir(tempDir, { recursive: true });

        // Download raw video from S3
        const ext = path.extname(originalFileName);
        tempVideoPath = path.join(tempDir, `input${ext}`);

        console.log(`[Worker] Downloading ${rawVideoKey} from S3...`);
        await job.updateProgress(5);
        await downloadFromS3(s3Client, bucket, rawVideoKey, tempVideoPath);

        console.log(`[Worker] Transcoding video...`);
        await job.updateProgress(10);

        // Transcode video
        await transcodeVideo(tempVideoPath, tempDir);
        await job.updateProgress(70);

        // Upload transcoded files to S3
        const hlsPrefix = rawVideoKey.replace('raw-videos/', '').replace(/\.[^/.]+$/, '');
        console.log(`[Worker] Uploading HLS files to ${hlsPrefix}...`);
        await uploadFolderToS3(s3Client, bucket, tempDir, hlsPrefix);
        await job.updateProgress(95);

        // Generate URLs
        const baseUrl = process.env.API_BASE_URL || 'http://localhost:2000';
        const hlsStreamUrl = `${baseUrl}/api/upload/hls/${hlsPrefix}/master.m3u8`;

        // Update job as completed
        await Job.findOneAndUpdate(
            { jobId },
            {
                status: 'completed',
                progress: 100,
                completedAt: new Date(),
                hlsPrefix,
                hlsStreamUrl,
                resolutions: {
                    '360p': { status: 'completed', progress: 100 },
                    '480p': { status: 'completed', progress: 100 },
                    '720p': { status: 'completed', progress: 100 },
                    '1080p': { status: 'completed', progress: 100 }
                }
            }
        );

        console.log(`[Worker] Job ${jobId} completed successfully`);

        return { success: true, hlsStreamUrl };

    } catch (error) {
        console.error(`[Worker] Job ${jobId} failed:`, error.message);

        // Update job as failed
        await Job.findOneAndUpdate(
            { jobId },
            {
                status: 'failed',
                failedAt: new Date(),
                $inc: { attempts: 1 },
                error: {
                    message: error.message,
                    stack: error.stack,
                    occurredAt: new Date()
                }
            }
        );

        throw error;

    } finally {
        // Cleanup temp files
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupErr) {
                console.warn('[Worker] Failed to cleanup temp dir:', cleanupErr.message);
            }
        }
    }
};

// Start the worker
const startWorker = async () => {
    await loadEnv();

    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/video-transcoder';
    await mongoose.connect(mongoURI);
    console.log('[Worker] MongoDB connected');

    // Redis configuration
    const redisConnection = new IORedis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null
    });

    console.log('[Worker] Starting video transcode worker...');

    const worker = new Worker('video-transcode', processJob, {
        connection: redisConnection,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2, // Process 2 jobs at a time
        limiter: {
            max: 10,
            duration: 60000 // Max 10 jobs per minute
        }
    });

    worker.on('completed', (job, result) => {
        console.log(`[Worker] Job ${job.id} completed`);
    });

    worker.on('failed', (job, error) => {
        console.error(`[Worker] Job ${job?.id} failed:`, error.message);
    });

    worker.on('error', (error) => {
        console.error('[Worker] Worker error:', error);
    });

    // Graceful shutdown
    const shutdown = async () => {
        console.log('[Worker] Shutting down gracefully...');
        await worker.close();
        await redisConnection.quit();
        await mongoose.disconnect();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log('[Worker] Worker is ready and listening for jobs');
};

// Run worker if executed directly
startWorker().catch(console.error);

export { processJob, startWorker };
