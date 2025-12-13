import { v4 as uuid } from 'uuid';
import Job from '../models/Job.js';
import { addTranscodeJob } from '../config/queue.js';
import s3, { getSignedUrl } from '../config/aws.js';

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
            const statusUrl = `${baseUrl}/api/v1/jobs/${jobId}/status`;

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
     * Returns current status of a transcoding job
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
                resolutions: job.resolutions,
                createdAt: job.createdAt,
                queuedAt: job.queuedAt,
                startedAt: job.startedAt
            };

            // Add completion info if done
            if (job.status === 'completed') {
                response.completedAt = job.completedAt;
                response.hlsStreamUrl = job.hlsStreamUrl;
            }

            // Add error info if failed
            if (job.status === 'failed') {
                response.failedAt = job.failedAt;
                response.error = job.error?.message;
                response.attempts = job.attempts;
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
                .select('jobId status progress createdAt completedAt hlsStreamUrl')
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
}

export default new AsyncUploadController();
