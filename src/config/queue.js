import { Queue } from 'bullmq';
import IORedis from 'ioredis';

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

// Video transcoding queue
export const transcodeQueue = new Queue('video-transcode', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000 // 1s, 4s, 16s
        },
        removeOnComplete: {
            age: 86400, // Keep completed jobs for 24 hours
            count: 100  // Keep last 100 completed jobs
        },
        removeOnFail: false // Keep failed jobs for debugging
    }
});

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
    console.log(`Job ${job.id} added to transcode queue`);
    return job;
};

export default transcodeQueue;
