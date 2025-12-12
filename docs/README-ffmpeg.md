# 🎥 ffmpeg.js - Video Transcoding Utility

## 📍 Location
`src/utils/ffmpeg.js`

---

## 🎯 What Does This File Do?

This file uses **FFmpeg** to convert a video into **HLS (HTTP Live Streaming)** format with multiple quality levels. It's like creating several versions of the same video, each optimized for different internet speeds.

---

## 📝 Code Breakdown

### Imports
```javascript
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);
```

| Import | Purpose |
|--------|---------|
| `execFile` | Run external commands (FFmpeg) |
| `promisify` | Convert callback-based functions to async/await |
| `path` | Handle file paths |
| `fs/promises` | File system operations (async) |

---

### Resolution Configuration
```javascript
const resolutions = {
    '360p': { width: 640, height: 360, bitrate: '800k', audioBitrate: '96k' },
    '480p': { width: 854, height: 480, bitrate: '1400k', audioBitrate: '128k' },
    '720p': { width: 1280, height: 720, bitrate: '2800k', audioBitrate: '128k' },
    '1080p': { width: 1920, height: 1080, bitrate: '5000k', audioBitrate: '192k' },
};
```

### Understanding Resolution Settings

| Quality | Resolution | Video Bitrate | Audio Bitrate | Use Case |
|---------|------------|---------------|---------------|----------|
| 360p | 640×360 | 800 kbps | 96 kbps | Slow internet, mobile data |
| 480p | 854×480 | 1400 kbps | 128 kbps | Standard mobile viewing |
| 720p | 1280×720 | 2800 kbps | 128 kbps | HD viewing, Wi-Fi |
| 1080p | 1920×1080 | 5000 kbps | 192 kbps | Full HD, fast internet |

### What is Bitrate?
**Bitrate** = Amount of data per second
- Higher bitrate = Better quality = Larger file
- Lower bitrate = Lower quality = Smaller file

```
800 kbps = 800,000 bits per second = ~100 KB per second
So a 1-minute 360p video ≈ 6 MB
```

---

### FFmpeg Arguments Explained

```javascript
const args = [
    '-y',                                          // Overwrite output without asking
    '-i', inputPath,                               // Input file
    '-vf', `scale=w=${opts.width}:h=${opts.height}`, // Resize video
    '-c:v', 'libx264',                             // Video codec (H.264)
    '-b:v', opts.bitrate,                          // Video bitrate
    '-c:a', 'aac',                                 // Audio codec
    '-b:a', opts.audioBitrate,                     // Audio bitrate
    '-f', 'hls',                                   // Output format (HLS)
    '-hls_time', '15',                             // Segment duration (15 seconds)
    '-hls_playlist_type', 'vod',                   // Video on Demand type
    '-hls_segment_filename', segmentPattern,       // Naming pattern for segments
    '-start_number', '0',                          // Start segment numbering at 0
    playlistPath,                                  // Output playlist file
];
```

### FFmpeg Arguments Table

| Argument | Meaning |
|----------|---------|
| `-y` | Overwrite output files without asking |
| `-i inputPath` | Input video file |
| `-vf scale=w:h` | Video filter to resize |
| `-c:v libx264` | Use H.264 video codec (most compatible) |
| `-b:v 800k` | Set video bitrate |
| `-c:a aac` | Use AAC audio codec (most compatible) |
| `-b:a 96k` | Set audio bitrate |
| `-f hls` | Output HLS format |
| `-hls_time 15` | Each segment is 15 seconds |
| `-hls_playlist_type vod` | Optimized for Video on Demand |
| `-hls_segment_filename` | Pattern for segment filenames |
| `-start_number 0` | First segment is segment000.ts |

---

## 📁 Output Structure

After transcoding, the output directory looks like:

```
outputDir/
├── master.m3u8       ← Master Playlist (links them all)
├── 360p/
│   ├── index.m3u8        ← Playlist file
│   ├── segment000.ts     ← First 15 seconds
│   ├── segment001.ts     ← Next 15 seconds
│   └── segment002.ts     ← And so on...
├── 480p/
│   ├── index.m3u8
│   ├── segment000.ts
│   └── ...
├── 720p/
│   └── ...
└── 1080p/
    └── ...
```

---

## 🔄 Transcoding Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                         TRANSCODING FLOW                                │
└────────────────────────────────────────────────────────────────────────┘

                   ┌─────────────────────┐
                   │   INPUT VIDEO       │
                   │   (myvideo.mp4)     │
                   │   1920x1080         │
                   │   Full HD           │
                   └─────────┬───────────┘
                             │
                             ▼
             ┌───────────────────────────────────┐
             │            FFmpeg                  │
             │   Processes one resolution        │
             │   at a time (sequential)          │
             └───────────────┬───────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│    360p       │    │    720p       │    │   1080p       │
│  640×360      │    │  1280×720     │    │  1920×1080    │
│               │    │               │    │               │
│ index.m3u8    │    │ index.m3u8    │    │ index.m3u8    │
│ segment000.ts │    │ segment000.ts │    │ segment000.ts │
│ segment001.ts │    │ segment001.ts │    │ segment001.ts │
│ ...           │    │ ...           │    │ ...           │
└───────────────┘    └───────────────┘    └───────────────┘
└───────────────┘    └───────────────┘    └───────────────┘
                              │                    │                    │
                              └────────────────────┼────────────────────┘
                                                   │
                                                   ▼
                                         ┌─────────────────────┐
                                         │  GENERATE MASTER    │
                                         │  PLAYLIST           │
                                         │  (master.m3u8)      │
                                         └─────────────────────┘
```

---

## 📄 HLS Playlist Example

The `index.m3u8` file looks like this:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:15
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:15.000000,
segment000.ts
#EXTINF:15.000000,
segment001.ts
#EXTINF:15.000000,
segment002.ts
#EXTINF:8.500000,
segment003.ts
#EXT-X-ENDLIST
```

### Playlist Tags Explained

| Tag | Meaning |
|-----|---------|
| `#EXTM3U` | File identifier (this is an M3U8 playlist) |
| `#EXT-X-VERSION:3` | HLS version 3 |
| `#EXT-X-TARGETDURATION:15` | Max segment duration is 15 seconds |
| `#EXT-X-PLAYLIST-TYPE:VOD` | Video on Demand (complete video, not live) |
| `#EXTINF:15.000000` | Next segment is 15 seconds long |
| `segment000.ts` | Filename of the segment |
| `#EXT-X-ENDLIST` | End of playlist (no more segments) |

---

## 🧠 Key Concepts

### What is FFmpeg?
**FFmpeg** is a command-line tool for processing video and audio. It can:
- Convert between formats (MP4 → HLS)
- Resize videos (1080p → 360p)
- Compress videos (reduce file size)
- Extract audio
- Merge videos
- And much more!

### What is H.264 (libx264)?
**H.264** is a video compression standard. It's:
- Supported by almost all devices and browsers
- Good balance of quality and file size
- Industry standard for web video

### What is AAC?
**AAC** (Advanced Audio Coding) is an audio compression format:
- Successor to MP3
- Better quality at lower bitrates
- Widely supported

### What are .ts Files?
**TS** (Transport Stream) files are video segments:
- Contain 15 seconds of video (in our config)
- Can be played independently
- Used by HLS for streaming

### Why Process Sequentially?
```javascript
for (const [resolution, opts] of Object.entries(resolutions)) {
    // Process one resolution at a time
}
```

FFmpeg is CPU-intensive. Running multiple FFmpeg processes simultaneously would:
- Overload the server
- Make each conversion slower
- Risk running out of memory

---

## ⏱️ Processing Time

Transcoding time depends on:
- Video length
- Input resolution
- Server CPU power

**Rough estimates for a 10-minute video:**
- 360p: ~2-3 minutes
- 480p: ~3-4 minutes
- 720p: ~5-7 minutes
- 1080p: ~8-12 minutes

Total: ~20-30 minutes for all four resolutions

---

## ⚠️ Error Handling

```javascript
try {
    await execFileAsync('ffmpeg', args);
} catch (err) {
    const e = new Error(`ffmpeg failed for ${resolution}: ${err.message}`);
    e.original = err;
    throw e;
}
```

If FFmpeg fails:
1. We catch the error
2. Add context (which resolution failed)
3. Preserve the original error
4. Re-throw so the caller can handle it

---

## 🔧 Prerequisites

For this to work, FFmpeg must be installed on the server:

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH

**Verify installation:**
```bash
ffmpeg -version
```

---

## 🔗 Related Files

This file is used by:
- [uploadController.js](./README-uploadController.md) - Calls transcodeVideo function
