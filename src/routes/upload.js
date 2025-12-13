import express from 'express';
import uploadToS3 from '../middlewares/multerS3.js';
import asyncUploadController from '../controllers/asyncUploadController.js';
import uploadController from '../controllers/uploadController.js';

const router = express.Router();

// ============================================
// V1 API - Async Queue-Based Upload (NEW)
// ============================================

// Upload video and queue for transcoding (returns 202 Accepted immediately)
router.post('/v1/upload',
    uploadToS3.single('video'),
    asyncUploadController.uploadAndEnqueue.bind(asyncUploadController)
);

// Get job status
router.get('/v1/jobs/:jobId/status',
    asyncUploadController.getJobStatus.bind(asyncUploadController)
);

// List all jobs
router.get('/v1/jobs',
    asyncUploadController.listJobs.bind(asyncUploadController)
);

// Retry a failed job
router.post('/v1/jobs/:jobId/retry',
    asyncUploadController.retryFailedJob.bind(asyncUploadController)
);

// Delete a job
router.delete('/v1/jobs/:jobId',
    asyncUploadController.deleteJob.bind(asyncUploadController)
);

// Get queue statistics
router.get('/v1/queue/stats',
    asyncUploadController.getQueueStatistics.bind(asyncUploadController)
);

// ============================================
// Legacy API - Sync Upload (Kept for backwards compatibility)
// ============================================

import multerMemory from '../middlewares/multerMemory.js';

// Legacy: Upload without transcoding
router.post('/upload',
    multerMemory.single('video'),
    uploadController.uploadVideo.bind(uploadController)
);

// Legacy: Upload with sync transcoding (blocks until complete)
router.post('/upload-transcode',
    multerMemory.single('video'),
    uploadController.uploadAndTranscode.bind(uploadController)
);

// ============================================
// HLS Proxy Routes (Shared by both APIs)
// ============================================

// Get the HLS master playlist
router.get('/hls/:videoId/master.m3u8',
    uploadController.proxyHlsMaster.bind(uploadController)
);

// Get the HLS playlist (rewrites segment URLs to point to our proxy)
router.get('/hls/:videoId/:quality/playlist.m3u8',
    uploadController.proxyHlsPlaylist.bind(uploadController)
);

// Get individual HLS segments
router.get('/hls/:videoId/:quality/:segment',
    uploadController.proxyHlsSegment.bind(uploadController)
);

// Get a streaming URL for a video
router.get('/stream/:videoId/:quality?',
    uploadController.getStreamUrl.bind(uploadController)
);

export default router;