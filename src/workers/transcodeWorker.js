import { Worker, Queue } from 'bullmq';
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
import LessonTranscode from '../models/LessonTranscode.js';

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
    const { jobId, rawVideoKey, originalFileName, lessonId, transcodeType = 'full' } = job.data;
    let tempDir = null;
    let tempVideoPath = null;

    console.log(`[Worker] Processing job ${jobId} (Type: ${transcodeType})`);

    const s3Client = createS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME;

    try {
        // Update job status to processing
        await Job.findOneAndUpdate(
            { jobId },
            { status: 'processing', startedAt: new Date() }
        );

        if (lessonId && transcodeType === 'fast') {
            await LessonTranscode.findOneAndUpdate({ lessonId }, { transcodingStatus: 'processing_low' });
        } else if (lessonId && (transcodeType === 'full' || transcodeType === 'full_remaining')) {
            await LessonTranscode.findOneAndUpdate({ lessonId }, { transcodingStatus: 'processing_high' });
        }

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

        // Determine resolutions based on type
        let targetResolutions;
        let playlistResolutions;

        if (transcodeType === 'fast') {
            targetResolutions = ['360p'];
            playlistResolutions = ['360p'];
        } else if (transcodeType === 'full_remaining') {
            targetResolutions = ['480p', '720p', '1080p'];
            playlistResolutions = ['360p', '480p', '720p', '1080p'];
        } else {
            // Default full
            targetResolutions = ['360p', '480p', '720p', '1080p'];
            playlistResolutions = ['360p', '480p', '720p', '1080p'];
        }

        // Transcode video
        // Pass options to transcodeVideo
        await transcodeVideo(tempVideoPath, tempDir, { targetResolutions, playlistResolutions });
        await job.updateProgress(70);

        // Upload transcoded files to S3
        const hlsPrefix = rawVideoKey.replace('raw-videos/', '').replace(/\.[^/.]+$/, '');
        console.log(`[Worker] Uploading HLS files to ${hlsPrefix}...`);
        await uploadFolderToS3(s3Client, bucket, tempDir, hlsPrefix);
        await job.updateProgress(95);

        // Generate URLs
        const baseUrl = process.env.API_BASE_URL || 'http://localhost:2000';
        const hlsStreamUrl = `${baseUrl}/api/upload/hls/${hlsPrefix}/master.m3u8`;

        // Update Lesson if exists
        if (lessonId) {
            const lessonUpdate = { hlsUrl: hlsStreamUrl };
            if (transcodeType === 'full' || transcodeType === 'full_remaining') {
                lessonUpdate.transcodingStatus = 'completed';
            }
            // For 'fast', we stay in 'processing_low' or maybe 'processing_high' if we consider it "live" but improving?
            // Actually, if 'fast' is done, user can watch.
            // Let's set to 'processing_low' done?
            // The plan said: "Fast Transcode (Low Quality / 360p) first, updates the Lesson with this HLS URL for immediate playback."
            await LessonTranscode.findOneAndUpdate({ lessonId }, lessonUpdate);
        }

        // Update job as completed
        await Job.findOneAndUpdate(
            { jobId },
            {
                status: 'completed',
                progress: 100,
                completedAt: new Date(),
                hlsPrefix,
                hlsStreamUrl
            }
        );

        console.log(`[Worker] Job ${jobId} completed successfully`);

        // If FAST phase completed, enqueue FULL phase
        if (transcodeType === 'fast') {
            console.log('[Worker] Enqueueing full quality transcode job...');
            const redisConnection = new IORedis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
            });
            const queue = new Queue('transcode', { connection: redisConnection });

            const newJobId = uuid();
            await Job.create({
                jobId: newJobId,
                originalFileName,
                rawVideoKey,
                status: 'queued',
                resolutions: { // simplistic init
                    '480p': { status: 'pending' }, '720p': { status: 'pending' }, '1080p': { status: 'pending' }
                }
            });

            await queue.add('transcode', {
                ...job.data,
                jobId: newJobId,
                transcodeType: 'full_remaining'
            });
            await queue.close(); // Important: close local queue connection or it keeps process alive/leaks
        }

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

        if (lessonId) {
            await LessonTranscode.findOneAndUpdate({ lessonId }, { transcodingStatus: 'failed' });
        }

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
        concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2,
        // Lock duration - how long the job is locked before being considered stalled
        lockDuration: 300000, // 5 minutes (transcoding can take a while)
        lockRenewTime: 150000, // Renew lock every 2.5 minutes
        stalledInterval: 60000, // Check for stalled jobs every minute
        maxStalledCount: 2, // Allow job to be stalled twice before failing
        limiter: {
            max: 10,
            duration: 60000 // Max 10 jobs per minute
        }
    });

    worker.on('completed', (job, result) => {
        console.log(`[Worker] ✓ Job ${job.id} completed successfully`);
    });

    worker.on('failed', (job, error) => {
        console.error(`[Worker] ✗ Job ${job?.id} failed: ${error.message}`);
    });

    worker.on('stalled', (jobId) => {
        console.warn(`[Worker] ⚠ Job ${jobId} stalled - will be retried`);
    });

    worker.on('progress', (job, progress) => {
        console.log(`[Worker] → Job ${job.id} progress: ${progress}%`);
    });

    worker.on('error', (error) => {
        console.error('[Worker] Worker error:', error);
    });

    // Graceful shutdown
    const shutdown = async () => {
        console.log('[Worker] Shutting down gracefully...');
        console.log('[Worker] Waiting for active jobs to complete (max 30s)...');
        await worker.close();
        await redisConnection.quit();
        await mongoose.disconnect();
        console.log('[Worker] Shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log('[Worker] Worker is ready and listening for jobs');
    console.log(`[Worker] Concurrency: ${parseInt(process.env.WORKER_CONCURRENCY) || 2}`);
};

// Run worker if executed directly
startWorker().catch(console.error);

export { processJob, startWorker };
