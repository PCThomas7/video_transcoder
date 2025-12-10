import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

export const transcodeVideo = async (inputPath, outputDir) => {
    const resolutions = {
        '360p': { width: 640, height: 360, bitrate: '800k', audioBitrate: '96k' },
        '480p': { width: 854, height: 480, bitrate: '1400k', audioBitrate: '128k' },
        '720p': { width: 1280, height: 720, bitrate: '2800k', audioBitrate: '128k' },
        '1080p': { width: 1920, height: 1080, bitrate: '5000k', audioBitrate: '192k' },
    };

    // Run ffmpeg sequentially per resolution to avoid overloading the host.
    for (const [resolution, opts] of Object.entries(resolutions)) {
        const resDir = path.join(outputDir, resolution);
        await fs.mkdir(resDir, { recursive: true });
        const playlistPath = path.join(resDir, 'index.m3u8');
        const segmentPattern = path.join(resDir, 'segment%03d.ts');

        const args = [
            '-y', // overwrite
            '-i', inputPath,
            '-vf', `scale=w=${opts.width}:h=${opts.height}`,
            '-c:v', 'libx264',
            '-b:v', opts.bitrate,
            '-c:a', 'aac',
            '-b:a', opts.audioBitrate,
            '-f', 'hls',
            '-hls_time', '15',
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', segmentPattern,
            '-start_number', '0',
            playlistPath,
        ];

        try {
            await execFileAsync('ffmpeg', args);
        } catch (err) {
            // add context and rethrow
            const e = new Error(`ffmpeg failed for ${resolution}: ${err.message}`);
            e.original = err;
            throw e;
        }
    }
};