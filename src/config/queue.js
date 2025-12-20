import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import Job from '../models/Job.js';

// Redis connection configuration
const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null // Required for BullMQ
};

// Create Redis connection
export const redisConnection = new IORedis(redisConfig);

// Log Redis connection status
redisConnection.on('connect', () => {
    console.log('Redis connected successfully');
});

redisConnection.on('error', (err) => {
    console.error('Redis connection error:', err.message);
});

// Video transcoding queue with enhanced options
export const transcodeQueue = new Queue('video-transcode', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000 // 2s, 8s, 32s (exponential)
        },
        removeOnComplete: {
            age: 86400,  // Keep completed jobs for 24 hours
            count: 100   // Keep last 100 completed jobs
        },
        removeOnFail: false, // Keep failed jobs for debugging
        // Stalled job detection - if a job doesn't report progress in 30s, mark as stalled
        stalledInterval: 30000
    }
});

// Queue Events - Listen for job lifecycle events
export const queueEvents = new QueueEvents('video-transcode', {
    connection: redisConnection
});

/**
 * Initialize queue event listeners
 * These run on the API server to track job status changes
 */
export const initQueueEvents = async () => {
    // When a job is added to the queue
    queueEvents.on('added', async ({ jobId, name }) => {
        console.log(`[Queue] Job ${jobId} added`);
    });

    // When a job starts processing
    queueEvents.on('active', async ({ jobId, prev }) => {
        console.log(`[Queue] Job ${jobId} is now active (was ${prev})`);
        try {
            await Job.findOneAndUpdate(
                { jobId },
                { status: 'processing', startedAt: new Date() }
            );
        } catch (err) {
            console.error(`[Queue] Failed to update job ${jobId} to active:`, err.message);
        }
    });

    // When a job reports progress
    queueEvents.on('progress', async ({ jobId, data }) => {
        console.log(`[Queue] Job ${jobId} progress: ${data}%`);
        try {
            await Job.findOneAndUpdate(
                { jobId },
                { progress: data }
            );
        } catch (err) {
            console.error(`[Queue] Failed to update job ${jobId} progress:`, err.message);
        }
    });

    // When a job completes successfully
    queueEvents.on('completed', async ({ jobId, returnvalue }) => {
        console.log(`[Queue] Job ${jobId} completed`);
        try {
            // Handle returnvalue that could be string, object, or undefined
            let result = {};
            if (returnvalue) {
                result = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
            }
            console.log(`[Queue] Job ${jobId} completed with result:`, result);
            await Job.findOneAndUpdate(
                { jobId },
                {
                    status: 'completed',
                    progress: 100,
                    completedAt: new Date(),
                    hlsStreamUrl: result.hlsStreamUrl
                }
            );
        } catch (err) {
            console.error(`[Queue] Failed to update job ${jobId} to completed:`, err.message, err);
        }
    });

    // When a job fails (after all retries exhausted)
    queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
        console.log(`[Queue] Job ${jobId} failed: ${failedReason}`);
        try {
            await Job.findOneAndUpdate(
                { jobId },
                {
                    status: 'failed',
                    failedAt: new Date(),
                    $inc: { attempts: 1 },
                    error: {
                        message: failedReason,
                        occurredAt: new Date()
                    }
                }
            );
        } catch (err) {
            console.error(`[Queue] Failed to update job ${jobId} to failed:`, err.message);
        }
    });

    // When a job is retried
    queueEvents.on('retries-exhausted', async ({ jobId, attemptsMade }) => {
        console.log(`[Queue] Job ${jobId} exhausted all ${attemptsMade} retries`);
    });

    // When a job becomes stalled (worker crashed mid-processing)
    queueEvents.on('stalled', async ({ jobId }) => {
        console.warn(`[Queue] Job ${jobId} stalled - worker may have crashed`);
        try {
            await Job.findOneAndUpdate(
                { jobId },
                {
                    status: 'queued', // Reset to queued so it can be retried
                    error: {
                        message: 'Job stalled - will be retried automatically',
                        occurredAt: new Date()
                    }
                }
            );
        } catch (err) {
            console.error(`[Queue] Failed to update stalled job ${jobId}:`, err.message);
        }
    });

    console.log('[Queue] Event listeners initialized');
};

/**
 * Add a video transcoding job to the queue
 * @param {Object} jobData - Job data containing video info
 * @param {Object} options - Optional BullMQ job options
 * @returns {Promise<import('bullmq').Job>}
 */
export const addTranscodeJob = async (jobData, options = {}) => {
    const job = await transcodeQueue.add('transcode', jobData, {
        jobId: jobData.jobId, // Use our custom jobId for easy reference
        ...options
    });
    console.log(`[Queue] Job ${job.id} added to transcode queue`);
    return job;
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        transcodeQueue.getWaitingCount(),
        transcodeQueue.getActiveCount(),
        transcodeQueue.getCompletedCount(),
        transcodeQueue.getFailedCount(),
        transcodeQueue.getDelayedCount()
    ]);

    return { waiting, active, completed, failed, delayed };
};

/**
 * Retry a failed job
 */
export const retryJob = async (jobId) => {
    const job = await transcodeQueue.getJob(jobId);
    if (job) {
        await job.retry();
        return true;
    }
    return false;
};

/**
 * Clean up old jobs
 */
export const cleanOldJobs = async (olderThanMs = 7 * 24 * 60 * 60 * 1000) => {
    await transcodeQueue.clean(olderThanMs, 1000, 'completed');
    await transcodeQueue.clean(olderThanMs, 1000, 'failed');
};

export default transcodeQueue;
