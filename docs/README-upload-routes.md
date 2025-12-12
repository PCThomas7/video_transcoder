# 🛣️ upload.js - API Routes Definition

## 📍 Location
`src/routes/upload.js`

---

## 🎯 What Does This File Do?

This file defines all the **API endpoints** (URLs) that clients can call. It's like a menu at a restaurant - it tells you what's available and how to order it.

---

## 📝 Code Breakdown

### Imports
```javascript
import express from 'express';
import uploadController from '../controllers/uploadController.js';
import multerMemory from '../middlewares/multerMemory.js';
import { s3Uploader } from '../middlewares/s3Uploader.js';
```

| Import | Purpose |
|--------|---------|
| `express` | To create the router |
| `uploadController` | Contains the logic for each endpoint |
| `multerMemory` | Handles file uploads |
| `s3Uploader` | (Imported but not used in current routes) |

---

### Router Creation
```javascript
const router = express.Router();
```

Creates a new router instance. Think of it as a mini-application that handles a group of related routes.

---

## 🚏 Routes Explained

### 1. Upload Without Transcoding
```javascript
router.post('/upload', 
    multerMemory.single('video'), 
    uploadController.uploadVideo.bind(uploadController)
);
```

| Part | Meaning |
|------|---------|
| `router.post` | This route responds to POST requests |
| `'/upload'` | The URL path (full: `/api/upload/upload`) |
| `multerMemory.single('video')` | First: handle file upload from 'video' field |
| `uploadController.uploadVideo` | Then: run this function |
| `.bind(uploadController)` | Keep `this` context correct |

**What it does:** Uploads the video directly to S3 without processing.

---

### 2. Upload With Transcoding
```javascript
router.post('/upload-transcode', 
    multerMemory.single('video'), 
    uploadController.uploadAndTranscode.bind(uploadController)
);
```

**What it does:**
1. Uploads the original video to S3
2. Transcodes it to multiple qualities (360p, 480p, 720p, 1080p)
3. Creates HLS playlists
4. Returns URLs for playing the video

---

### 3. HLS Master Playlist Proxy
```javascript
router.get('/hls/:videoId/master.m3u8', 
    uploadController.proxyHlsMaster.bind(uploadController)
);
```

**Example URL:** `/api/upload/hls/abc123-video/master.m3u8`

**What it does:** Fetches the **Master Playlist** from S3. This playlist links to all the other quality levels (360p, 480p, etc.) and allows the video player to automatically switch qualities.

---

### 4. HLS Playlist Proxy
```javascript
router.get('/hls/:videoId/:quality/playlist.m3u8', 
    uploadController.proxyHlsPlaylist.bind(uploadController)
);
```

| Part | Meaning |
|------|---------|
| `router.get` | Responds to GET requests |
| `:videoId` | URL parameter - the video identifier |
| `:quality` | URL parameter - like '360p' or '720p' |
| `playlist.m3u8` | Fixed filename |

**Example URL:** `/api/upload/hls/abc123-video/360p/playlist.m3u8`

**What it does:** Fetches the HLS playlist from S3 and modifies the segment URLs to point to our server (for private bucket access).

---

### 5. HLS Segment Proxy
```javascript
router.get('/hls/:videoId/:quality/:segment', 
    uploadController.proxyHlsSegment.bind(uploadController)
);
```

**Example URL:** `/api/upload/hls/abc123-video/360p/segment000.ts`

**What it does:** Fetches individual video segments from S3 and streams them to the client.

---

### 6. Get Stream URL
```javascript
router.get('/stream/:videoId/:quality?', 
    uploadController.getStreamUrl.bind(uploadController)
);
```

| Part | Meaning |
|------|---------|
| `:quality?` | Optional parameter (notice the `?`) |

**What it does:** Returns a streaming URL for a video. If quality is not specified, defaults to 360p.

---

## 🎯 URL Parameters Explained

```
/hls/:videoId/:quality/:segment
      ↓         ↓        ↓
      │         │        └── segment000.ts
      │         └── 360p
      └── abc123-myvideo
```

These parameters are accessible in the controller as:
```javascript
req.params.videoId  // 'abc123-myvideo'
req.params.quality  // '360p'
req.params.segment  // 'segment000.ts'
```

---

## 🔄 Request Flow Visualization

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CLIENT REQUEST                                  │
│       POST /api/upload/upload-transcode                                │
│       Content-Type: multipart/form-data                                │
│       Body: video file                                                  │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         EXPRESS SERVER                                  │
│                                                                        │
│   index.js: app.use('/api/upload', uploadRouter)                       │
│                      │                                                 │
│                      ▼                                                 │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                    upload.js (ROUTER)                         │    │
│   │                                                               │    │
│   │   POST /upload-transcode matched!                             │    │
│   │                                                               │    │
│   │   Step 1: multerMemory.single('video')                       │    │
│   │           └── Parse uploaded file                             │    │
│   │           └── Store in req.file                               │    │
│   │                                                               │    │
│   │   Step 2: uploadController.uploadAndTranscode                 │    │
│   │           └── Process the video                               │    │
│   │           └── Send response                                   │    │
│   │                                                               │    │
│   └──────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Complete API Reference

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|--------------|
| POST | `/api/upload/upload` | Upload video without transcoding | `multipart/form-data` with 'video' field |
| POST | `/api/upload/upload-transcode` | Upload and transcode video | `multipart/form-data` with 'video' field |
| GET | `/api/upload/hls/:videoId/master.m3u8` | Get HLS master playlist | - |
| GET | `/api/upload/hls/:videoId/:quality/playlist.m3u8` | Get HLS playlist | - |
| GET | `/api/upload/hls/:videoId/:quality/:segment` | Get HLS segment | - |
| GET | `/api/upload/stream/:videoId/:quality?` | Get stream URL | - |

---

## 🧠 Key Concepts

### What is a Router?
A router is a way to organize routes in Express. Instead of defining all routes in `index.js`, you can group related routes in separate files.

```javascript
// Without router (messy)
app.post('/api/upload/upload', ...)
app.post('/api/upload/transcode', ...)
app.get('/api/upload/hls', ...)

// With router (organized)
app.use('/api/upload', uploadRouter)
// All routes in uploadRouter automatically get /api/upload prefix
```

### What is .bind()?
`.bind(uploadController)` ensures that when the method runs, `this` refers to the controller object. Without it, `this` would be undefined.

### What is a Route Parameter?
Parts of the URL that can change:
```
/hls/:videoId/:quality
      ↑         ↑
      These are parameters
```

### What are HTTP Methods?
| Method | Purpose |
|--------|---------|
| GET | Retrieve data |
| POST | Create/send data |
| PUT | Update data |
| DELETE | Remove data |

---

## 🔗 Related Files

This file uses:
- [multerMemory.js](./README-multerMemory.md) - File upload handling
- [uploadController.js](./README-uploadController.md) - Route handlers

This file is used by:
- [index.js](./README-index.md) - Mounts the router
