import express from 'express';
import uploadController from '../controllers/uploadController.js';
import multerMemory from '../middlewares/multerMemory.js';
import { s3Uploader } from '../middlewares/s3Uploader.js';

const router = express.Router();

// Route: Upload without transcoding - returns HLS URL
router.post('/upload', multerMemory.single('video'), uploadController.uploadVideo.bind(uploadController));

// Route: Upload with transcoding - returns HLS URL after transcoding
router.post('/upload-transcode', multerMemory.single('video'), uploadController.uploadAndTranscode.bind(uploadController));

// HLS Proxy Routes - These allow streaming from private S3/Wasabi buckets
// Get the HLS playlist (rewrites segment URLs to point to our proxy)
router.get('/hls/:videoId/:quality/playlist.m3u8', uploadController.proxyHlsPlaylist.bind(uploadController));

// Get individual HLS segments
router.get('/hls/:videoId/:quality/:segment', uploadController.proxyHlsSegment.bind(uploadController));

// Get a streaming URL for a video (returns proxy URL)
router.get('/stream/:videoId/:quality?', uploadController.getStreamUrl.bind(uploadController));

export default router;