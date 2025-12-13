import { v4 as uuid } from 'uuid';
import Job from '../models/Job.js';
import { addTranscodeJob, getQueueStats, retryJob } from '../config/queue.js';

class AsyncUploadController {
    /**
     * POST /api/v1/upload
     * Accepts video upload (streamed to S3), creates job record, enqueues for transcoding
     * Returns immediately with jobId (HTTP 202 Accepted)
     */
    async uploadAndEnqueue(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No video file uploaded' });
            }

            const jobId = req.videoId || uuid();
            const rawVideoKey = req.videoKey || req.file.key;

            // Create job record in MongoDB
            const job = new Job({
                jobId,
                originalFileName: req.file.originalname,
                originalFileSize: req.file.size,
                mimeType: req.file.mimetype,
                rawVideoKey,
                status: 'queued',
                queuedAt: new Date()
            });

            await job.save();

            // Enqueue transcoding job
            await addTranscodeJob({
                jobId,
                rawVideoKey,
                originalFileName: req.file.originalname
            });

            // Construct status URL
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const statusUrl = `${baseUrl}/api/upload/v1/jobs/${jobId}/status`;

            // Return 202 Accepted with job info
            return res.status(202).json({
                message: 'Video uploaded and queued for transcoding',
                jobId,
                statusUrl,
                note: 'Use the statusUrl to track progress. Transcoding happens asynchronously.'
            });

        } catch (error) {
            console.error('Upload error:', error);
            return res.status(500).json({ error: 'Failed to upload video' });
        }
    }

    /**
     * GET /api/v1/jobs/:jobId/status
     * Returns current status of a transcoding job with detailed progress info
     */
    async getJobStatus(req, res) {
        try {
            const { jobId } = req.params;

            const job = await Job.findOne({ jobId }).lean();

            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }

            const response = {
                jobId: job.jobId,
                status: job.status,
                progress: job.progress,
                originalFileName: job.originalFileName,
                originalFileSize: job.originalFileSize,
                resolutions: job.resolutions,
                createdAt: job.createdAt,
                queuedAt: job.queuedAt,
                startedAt: job.startedAt
            };

            // Add completion info if done
            if (job.status === 'completed') {
                response.completedAt = job.completedAt;
                response.hlsStreamUrl = job.hlsStreamUrl;
                response.hlsPrefix = job.hlsPrefix;
                // Calculate processing time
                if (job.startedAt && job.completedAt) {
                    response.processingTimeMs = new Date(job.completedAt) - new Date(job.startedAt);
                }
            }

            // Add error info if failed
            if (job.status === 'failed') {
                response.failedAt = job.failedAt;
                response.error = job.error?.message;
                response.attempts = job.attempts;
                response.maxAttempts = job.maxAttempts;
                response.canRetry = job.attempts < job.maxAttempts;
            }

            return res.status(200).json(response);

        } catch (error) {
            console.error('Status check error:', error);
            return res.status(500).json({ error: 'Failed to get job status' });
        }
    }

    /**
     * GET /api/v1/jobs
     * List all jobs with optional status filter
     */
    async listJobs(req, res) {
        try {
            const { status, limit = 20, offset = 0 } = req.query;

            const query = status ? { status } : {};

            const jobs = await Job.find(query)
                .sort({ createdAt: -1 })
                .skip(parseInt(offset))
                .limit(parseInt(limit))
                .select('jobId originalFileName status progress createdAt completedAt hlsStreamUrl error')
                .lean();

            const total = await Job.countDocuments(query);

            return res.status(200).json({
                jobs,
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

        } catch (error) {
            console.error('List jobs error:', error);
            return res.status(500).json({ error: 'Failed to list jobs' });
        }
    }

    /**
     * POST /api/v1/jobs/:jobId/retry
     * Retry a failed job
     */
    async retryFailedJob(req, res) {
        try {
            const { jobId } = req.params;

            const job = await Job.findOne({ jobId });

            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }

            if (job.status !== 'failed') {
                return res.status(400).json({
                    error: 'Only failed jobs can be retried',
                    currentStatus: job.status
                });
            }

            if (job.attempts >= job.maxAttempts) {
                return res.status(400).json({
                    error: 'Maximum retry attempts reached',
                    attempts: job.attempts,
                    maxAttempts: job.maxAttempts
                });
            }

            // Reset job status and re-queue
            await Job.findOneAndUpdate(
                { jobId },
                {
                    status: 'queued',
                    queuedAt: new Date(),
                    error: null
                }
            );

            await addTranscodeJob({
                jobId,
                rawVideoKey: job.rawVideoKey,
                originalFileName: job.originalFileName
            });

            return res.status(200).json({
                message: 'Job queued for retry',
                jobId,
                attempt: job.attempts + 1
            });

        } catch (error) {
            console.error('Retry job error:', error);
            return res.status(500).json({ error: 'Failed to retry job' });
        }
    }

    /**
     * GET /api/v1/queue/stats
     * Get queue statistics
     */
    async getQueueStatistics(req, res) {
        try {
            const stats = await getQueueStats();

            // Also get MongoDB counts by status
            const dbStats = await Job.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]);

            const dbStatusCounts = {};
            dbStats.forEach(s => {
                dbStatusCounts[s._id] = s.count;
            });

            return res.status(200).json({
                queue: stats,
                database: dbStatusCounts,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Queue stats error:', error);
            return res.status(500).json({ error: 'Failed to get queue stats' });
        }
    }

    /**
     * DELETE /api/v1/jobs/:jobId
     * Cancel a pending/queued job or delete a completed/failed job record
     */
    async deleteJob(req, res) {
        try {
            const { jobId } = req.params;

            const job = await Job.findOne({ jobId });

            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }

            // Cannot delete jobs that are currently processing
            if (job.status === 'processing') {
                return res.status(400).json({
                    error: 'Cannot delete job while processing',
                    currentStatus: job.status
                });
            }

            // Delete from MongoDB
            await Job.deleteOne({ jobId });

            return res.status(200).json({
                message: 'Job deleted successfully',
                jobId
            });

        } catch (error) {
            console.error('Delete job error:', error);
            return res.status(500).json({ error: 'Failed to delete job' });
        }
    }
}

export default new AsyncUploadController();
