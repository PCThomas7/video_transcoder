import s3, { getSignedUrl } from '../config/aws.js';
import { v4 as uuid } from 'uuid';
import { transcodeVideo } from '../utils/ffmpeg.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

class UploadController {
    async uploadVideo(req, res) {
        try {
            if (!req.file) {
                return res.status(400).send('No file uploaded.');
            }
            const fileName = `${uuid()}-${req.file.originalname}`;
            const params = {
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: fileName,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,

            };

            const uploadResult = await s3.upload(params).promise();
            const videoUrl = uploadResult.Location;
            const hlsPlaylistUrl = `${videoUrl.replace(/\.[^/.]+$/, '')}/360p/index.m3u8`;

            return res.status(200).json({
                message: 'Video uploaded successfully',
                videoUrl,
                hlsPlaylistUrl
            });
        } catch (error) {
            console.error('Error uploading video:', error);
            return res.status(500).send('Error uploading video.');
        }
    }

    async uploadAndTranscode(req, res) {
        let tempVideoPath = null;
        let tempDir = null;
        try {
            if (!req.file) {
                return res.status(400).send('No file uploaded.');
            }
            const fileName = `${uuid()}-${req.file.originalname}`;
            const params = {
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: fileName,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            const videoUrl = uploadResult.Location;

            // Write uploaded file to temp local file
            tempDir = path.join(os.tmpdir(), `transcode-${uuid()}`);
            await fs.mkdir(tempDir, { recursive: true });
            tempVideoPath = path.join(tempDir, `input-${uuid()}${path.extname(req.file.originalname)}`);
            await fs.writeFile(tempVideoPath, req.file.buffer);

            // Transcode from local temp file
            await transcodeVideo(tempVideoPath, tempDir);

            // helper: simple content type mapping
            const getContentType = (p) => {
                const ext = path.extname(p).toLowerCase();
                if (ext === '.m3u8') return 'application/vnd.apple.mpegurl';
                if (ext === '.ts') return 'video/MP2T';
                if (ext === '.png') return 'image/png';
                if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
                return 'application/octet-stream';
            };

            // Recursively upload folder contents to S3 under a prefix matching the original key (without extension)
            const uploadFolderToS3 = async (localDir, s3Prefix) => {
                const entries = await fs.readdir(localDir, { withFileTypes: true });
                for (const entry of entries) {
                    const localPath = path.join(localDir, entry.name);
                    const key = `${s3Prefix}/${entry.name}`;
                    if (entry.isDirectory()) {
                        await uploadFolderToS3(localPath, key);
                    } else {
                        const body = await fs.readFile(localPath);
                        await s3.upload({
                            Bucket: process.env.AWS_S3_BUCKET_NAME,
                            Key: key,
                            Body: body,
                            ContentType: getContentType(localPath),
                        }).promise();
                    }
                }
            };

            const hlsPrefix = `${fileName.replace(/\.[^/.]+$/, '')}`;
            await uploadFolderToS3(tempDir, hlsPrefix);

            // Generate pre-signed URLs for secure access (24 hours expiry by default)
            const videoSignedUrl = getSignedUrl(fileName);
            const hlsPlaylistKey = `${hlsPrefix}/360p/index.m3u8`;
            const hlsPlaylistSignedUrl = getSignedUrl(hlsPlaylistKey);

            // Also generate signed URLs for HLS segments (they're referenced in the playlist)
            // The player will need these to actually play the video
            const getHlsSegmentUrls = async (prefix) => {
                const segmentKeys = [];
                const listParams = {
                    Bucket: process.env.AWS_S3_BUCKET_NAME,
                    Prefix: prefix,
                };
                const listedObjects = await s3.listObjectsV2(listParams).promise();
                for (const obj of listedObjects.Contents || []) {
                    segmentKeys.push({
                        key: obj.Key,
                        signedUrl: getSignedUrl(obj.Key),
                    });
                }
                return segmentKeys;
            };

            const segments = await getHlsSegmentUrls(hlsPrefix);

            // Build proxy URL for HLS streaming (works with private buckets)
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const hlsProxyUrl = `${baseUrl}/api/upload/hls/${hlsPrefix}/360p/playlist.m3u8`;

            return res.status(200).json({
                message: 'Video uploaded and transcoded successfully',
                videoUrl: videoSignedUrl,
                // For direct access with pre-signed URL (expires in 24 hours)
                hlsPlaylistUrl: hlsPlaylistSignedUrl,
                // For streaming via proxy (recommended for HLS playback)
                hlsStreamUrl: `${baseUrl}/api/upload/hls/${hlsPrefix}/master.m3u8`,
                // Video ID for future reference
                videoId: hlsPrefix,
                // Include segment info for debugging/advanced usage
                hlsSegments: segments,
                // Note: Pre-signed URLs expire in 24 hours
                expiresIn: '24 hours',
            });
        } catch (error) {
            console.error('Error uploading/transcoding video:', error);
            return res.status(500).json({ error: 'Error uploading/transcoding video.' });
        } finally {
            // Cleanup temp video file if needed
            if (tempVideoPath) {
                try {
                    await fs.unlink(tempVideoPath);
                } catch (cleanupErr) {
                    console.warn('Failed to cleanup temp video:', cleanupErr.message);
                }
            }
            // remove temp dir and all contents
            if (tempDir) {
                try {
                    await fs.rm(tempDir, { recursive: true, force: true });
                } catch (cleanupErr) {
                    console.warn('Failed to cleanup temp dir:', cleanupErr.message);
                }
            }
        }
    }

    /**
     * Proxy endpoint to serve HLS playlist with rewritten segment URLs
     * This allows the player to fetch segments through our server (which has S3 access)
     */
    async proxyHlsPlaylist(req, res) {
        try {
            const { courseId = "streamaaa", lessonId, videoId, quality } = req.params;
            const key = `recordings/${courseId}/${lessonId}/${videoId}/${quality}/index.m3u8`;

            const params = {
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: key,
            };

            const data = await s3.getObject(params).promise();
            let playlistContent = data.Body.toString('utf-8');

            // Rewrite segment URLs to point to our proxy endpoint
            // Replace relative .ts references with our proxy URL
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            playlistContent = playlistContent.replace(
                /^(segment\d+\.ts)$/gm,
                `${baseUrl}/api/upload/hls/${courseId}/${lessonId}/${videoId}/${quality}/$1`
            );

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(playlistContent);
        } catch (error) {
            console.error('Error proxying HLS playlist:', error);
            return res.status(500).json({ error: 'Error fetching HLS playlist' });
        }
    }

    /**
     * Proxy endpoint to serve HLS master playlist
     */
    async proxyHlsMaster(req, res) {
        try {
            const { courseId = "streamaaa", lessonId, videoId } = req.params;
            const key = `recordings/${courseId}/${lessonId}/${videoId}/master.m3u8`;
            console.log(key);

            const params = {
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: key,
            };

            const data = await s3.getObject(params).promise();
            let playlistContent = data.Body.toString('utf-8');

            // Rewrite variant playlist URLs to point to our proxy endpoint
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            // The master playlist contains lines like "360p/index.m3u8"
            // We want to rewrite them to look like: "{baseUrl}/api/upload/hls/{videoId}/360p/playlist.m3u8"

            playlistContent = playlistContent.replace(
                /^(\d+p)\/index\.m3u8$/gm,
                `${baseUrl}/api/upload/hls/${courseId}/${lessonId}/${videoId}/$1/playlist.m3u8`
            );

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(playlistContent);
        } catch (error) {
            console.error('Error proxying HLS master playlist:', error);
            return res.status(500).json({ error: 'Error fetching HLS master playlist' });
        }
    }

    /**
     * Proxy endpoint to serve HLS segments (.ts files)
     * OPTIMIZED: Uses streaming instead of buffering for faster HD playback
     */
    async proxyHlsSegment(req, res) {
        try {
            const { courseId = "streamaaa", lessonId, videoId, quality, segment } = req.params;
            const key = `recordings/${courseId}/${lessonId}/${videoId}/${quality}/${segment}`;
            console.log(key);

            const params = {
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: key,
            };

            // Get object metadata first to set content-length
            const headData = await s3.headObject(params).promise();

            // Set headers for streaming
            res.setHeader('Content-Type', 'video/MP2T');
            res.setHeader('Content-Length', headData.ContentLength);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache segments for 1 year
            res.setHeader('Accept-Ranges', 'bytes');

            // Stream directly from S3 to response (no buffering!)
            const s3Stream = s3.getObject(params).createReadStream();

            s3Stream.on('error', (err) => {
                console.error('S3 stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming segment' });
                }
            });

            // Pipe S3 stream directly to response
            s3Stream.pipe(res);

        } catch (error) {
            console.error('Error proxying HLS segment:', error);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Error fetching HLS segment' });
            }
        }
    }

    /**
     * Get streaming URL that works with the proxy
     * Returns a URL to our proxy endpoint instead of direct S3 URL
     */
    async getStreamUrl(req, res) {
        try {
            const { courseId = "streamaaa", lessonId, videoId, quality } = req.params;
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            // Return master playlist by default if no quality specified, otherwise specific quality
            let proxyUrl;
            if (quality) {
                proxyUrl = `${baseUrl}/api/upload/hls/${courseId}/${lessonId}/${videoId}/${quality}/playlist.m3u8`;
            } else {
                proxyUrl = `${baseUrl}/api/upload/hls/${courseId}/${lessonId}/${videoId}/master.m3u8`;
            }

            return res.status(200).json({
                hlsPlaylistUrl: proxyUrl,
                message: 'Use this URL with an HLS player'
            });
        } catch (error) {
            console.error('Error generating stream URL:', error);
            return res.status(500).json({ error: 'Error generating stream URL' });
        }
    }
}

export default new UploadController();