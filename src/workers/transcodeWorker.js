import axios from 'axios';
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
const createS3Client = () => {
    const wasabiEndpoint = process.env.WASABI_ENDPOINT || 's3.ap-south-1.wasabisys.com';
    const endpoint = wasabiEndpoint.startsWith('http') ? wasabiEndpoint : `https://${wasabiEndpoint}`;
    const region = process.env.WASABI_REGION || process.env.AWS_REGION || 'ap-south-1';
    const accessKeyId = process.env.WASABI_KEY || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.WASABI_SECRET || process.env.AWS_SECRET_ACCESS_KEY;

    // Debug: Log which credentials are being used (masked)
    console.log('[Worker] S3 Config:', {
        endpoint,
        region,
        accessKeyId: accessKeyId ? `${accessKeyId.substring(0, 4)}...${accessKeyId.substring(accessKeyId.length - 4)}` : 'MISSING',
        hasSecret: !!secretAccessKey
    });

    return new S3Client({
        region,
        endpoint,
        credentials: {
            accessKeyId,
            secretAccessKey
        },
        forcePathStyle: true
    });
};

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
    const { jobId, rawVideoKey, originalFileName, lessonId, transcodeType = 'fast', localFilePath } = job.data;
    let tempDir = null;
    let inputVideoPath = null;

    console.log(`[Worker] Processing job ${jobId} (Type: ${transcodeType})`);

    const s3Client = createS3Client();
    const bucket = process.env.WASABI_BUCKET || process.env.AWS_S3_BUCKET_NAME;

    try {
        // Update job status to processing
        await Job.findOneAndUpdate(
            { jobId },
            { status: 'processing', startedAt: new Date() }
        );

        if (lessonId && transcodeType === 'fast') {
            await LessonTranscode.findOneAndUpdate({ lessonId }, { transcodingStatus: 'processing_low' });
        } else if (lessonId && transcodeType === 'background') {
            await LessonTranscode.findOneAndUpdate({ lessonId }, { transcodingStatus: 'processing_high' });
        }

        // Create temp directory for output
        tempDir = path.join(os.tmpdir(), `transcode-${uuid()}`);
        await fs.mkdir(tempDir, { recursive: true });

        // Use local file if available (streaming recordings), otherwise download from S3
        if (localFilePath) {
            console.log(`[Worker] Using local file: ${localFilePath}`);
            inputVideoPath = localFilePath;
        } else {
            // Fallback: Download from S3 (for API uploads)
            const ext = path.extname(originalFileName);
            inputVideoPath = path.join(tempDir, `input${ext}`);
            console.log(`[Worker] Downloading ${rawVideoKey} from S3...`);
            await downloadFromS3(s3Client, bucket, rawVideoKey, inputVideoPath);
        }

        await job.updateProgress(5);

        console.log(`[Worker] Transcoding video (${transcodeType})...`);
        await job.updateProgress(10);

        // Determine resolutions and performance settings based on type
        let targetResolutions;
        let playlistResolutions;
        let cpuThreads;
        let preset;

        if (transcodeType === 'fast') {
            targetResolutions = ['360p'];
            playlistResolutions = ['360p'];
            cpuThreads = 0; // Use full CPU for fast burst
            preset = 'ultrafast'; // Max speed for low latency
        } else {
            // Background / Full remaining
            targetResolutions = ['480p', '720p', '1080p'];
            playlistResolutions = ['360p', '480p', '720p', '1080p'];
            cpuThreads = 2; // Restrict background to 2 cores
            preset = 'medium'; // Better quality for final versions
        }

        // Transcode video
        await transcodeVideo(inputVideoPath, tempDir, {
            targetResolutions,
            playlistResolutions,
            cpuThreads,
            preset
        });
        await job.updateProgress(70);

        // Upload transcoded files to S3
        const hlsPrefix = rawVideoKey.replace('raw-videos/', '').replace(/\.[^/.]+$/, '');
        console.log(`[Worker] Uploading HLS files to ${hlsPrefix}...`);
        hlsPrefix.replace('/recordings/', '');
        await uploadFolderToS3(s3Client, bucket, tempDir, hlsPrefix);
        await job.updateProgress(95);

        // Generate URLs
        const baseUrl = process.env.API_BASE_URL || 'http://localhost:2000';
        const hlsStreamUrl = `${baseUrl}/api/upload/hls/${hlsPrefix.replace('recordings/', '')}/master.m3u8`;

        // Update Lesson if exists
        if (lessonId) {
            const lessonUpdate = { hlsUrl: hlsStreamUrl };
            if (transcodeType === 'background') {
                lessonUpdate.transcodingStatus = 'completed';
            }
            await LessonTranscode.findOneAndUpdate({ lessonId }, lessonUpdate);

            if (hlsStreamUrl) {
                try {
                    console.log(`[Worker] Calling webhook to update lesson ${lessonId} with HLS URL`);
                    await axios.post(`${process.env.BACKEND_URL}/api/lessons/webhook/update-video`, {
                        lessonId,
                        hlsUrl: hlsStreamUrl,
                        SECRET_KEY: process.env.SECRET_KEY
                    });
                } catch (err) {
                    console.error('[Worker] Failed to send update webhook:', err.message);
                }
            }
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

        // If FAST phase completed, enqueue BACKGROUND phase
        if (transcodeType === 'fast') {
            console.log('[Worker] Enqueueing high quality transcode job to background lane...');
            const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
                maxRetriesPerRequest: null
            });
            const queue = new Queue('transcode-background', { connection: redisConnection });

            const newJobId = uuid();
            await Job.create({
                jobId: newJobId,
                originalFileName,
                rawVideoKey,
                status: 'queued',
                resolutions: {
                    '480p': { status: 'pending' }, '720p': { status: 'pending' }, '1080p': { status: 'pending' }
                }
            });

            await queue.add('transcode-background', {
                ...job.data,
                jobId: newJobId,
                transcodeType: 'background'
            });
            await queue.close();
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

    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/video-transcoder';
    await mongoose.connect(mongoURI);
    console.log('[Worker] MongoDB connected');

    const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: null
    });

    console.log('[Worker] Starting Smart Burst transcode workers...');

    // 1. Fast Lane Worker (360p Burst)
    const fastWorker = new Worker('transcode-fast', processJob, {
        connection: redisConnection,
        concurrency: 1, // High power, sequential
        lockDuration: 60000, // 1 minute is plenty for 360p burst
    });

    // 2. Background Lane Worker (High Quality Restricted)
    const backgroundWorker = new Worker('transcode-background', processJob, {
        connection: redisConnection,
        concurrency: 1, // Background sequential
        lockDuration: 600000, // 10 minutes for HD transcoding
    });

    const setupListeners = (worker, name) => {
        worker.on('completed', (job) => console.log(`[${name}] ✓ Job ${job.id} done`));
        worker.on('failed', (job, err) => console.error(`[${name}] ✗ Job ${job?.id} failed: ${err.message}`));
        worker.on('progress', (job, progress) => console.log(`[${name}] → Job ${job.id}: ${progress}%`));
    };

    setupListeners(fastWorker, 'FastWorker');
    setupListeners(backgroundWorker, 'BackgroundWorker');

    const shutdown = async () => {
        console.log('[Worker] Shutting down gracefully...');
        await fastWorker.close();
        await backgroundWorker.close();
        await redisConnection.quit();
        await mongoose.disconnect();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log('[Worker] Workers are ready and listening');
};

startWorker().catch(console.error);

export { processJob, startWorker };

// Run worker if executed directly
startWorker().catch(console.error);

export { processJob, startWorker };
