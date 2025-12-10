# 🎬 Video Transcoder S3 - Complete Beginner's Guide

## What is This Project?

This is a **Video Transcoder** backend application. In simple terms, it takes a video file you upload and:

1. **Stores it** in cloud storage (Wasabi S3 - similar to Amazon S3)
2. **Converts it** into multiple quality versions (360p, 480p, 720p, 1080p)
3. **Creates HLS streams** so the video can be played smoothly on the web

---

## 🤔 What is Video Transcoding?

**Transcoding** means converting a video from one format to another. Think of it like translating a book from one language to multiple languages.

For example:
- You upload a 4K video
- The system creates versions in: 360p, 480p, 720p, and 1080p
- Users with slow internet can watch the 360p version
- Users with fast internet can watch the 1080p version

---

## 🎯 What is HLS (HTTP Live Streaming)?

**HLS** is a way to stream videos smoothly over the internet. Instead of downloading the entire video at once, HLS:

1. **Splits the video** into small chunks (segments, usually 15 seconds each)
2. **Creates a playlist** (`.m3u8` file) that lists all the chunks
3. **The video player** downloads chunks one by one as you watch

This allows:
- ✅ Faster video start (no need to wait for full download)
- ✅ Adaptive quality (switch quality based on internet speed)
- ✅ Better buffering management

---

## 📁 Project Structure

```
src/
├── index.js                 # 🚀 Entry point - starts the server
├── config/
│   └── aws.js               # ☁️ AWS/Wasabi S3 configuration
├── controllers/
│   └── uploadController.js  # 🎮 Main logic for handling uploads
├── middlewares/
│   └── multerMemory.js      # 📦 Handles file upload in memory
├── routes/
│   └── upload.js            # 🛣️ Defines API endpoints
└── utils/
    └── ffmpeg.js            # 🎥 Video transcoding with FFmpeg
```

---

## 🔄 How the Application Flow Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VIDEO UPLOAD FLOW                                │
└─────────────────────────────────────────────────────────────────────────┘

     1. User uploads video
              │
              ▼
┌─────────────────────────┐
│    POST /api/upload/    │  ← Route (upload.js)
│    upload-transcode     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Multer Middleware     │  ← Stores file in memory (multerMemory.js)
│   (memoryStorage)       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Upload Controller     │  ← Main processing logic (uploadController.js)
│                         │
│   Steps:                │
│   1. Upload to S3       │  ← Uses aws.js
│   2. Save to temp file  │
│   3. Transcode video    │  ← Uses ffmpeg.js
│   4. Upload HLS to S3   │
│   5. Return URLs        │
└────────────┬────────────┘
             │
             ▼
    ┌─────────────────┐
    │  JSON Response  │
    │  with video URLs│
    └─────────────────┘
```

---

## 🛠️ Technologies Used

| Technology | Purpose |
|------------|---------|
| **Express.js** | Web framework for handling HTTP requests |
| **Multer** | Handling file uploads |
| **AWS SDK** | Connecting to Wasabi/S3 cloud storage |
| **FFmpeg** | Video transcoding (converting video formats) |
| **UUID** | Generating unique file names |

---

## 📚 Documentation Files

Each file has its own detailed documentation:

1. [📄 index.js - Entry Point](./README-index.md)
2. [📄 aws.js - AWS Configuration](./README-aws.md)
3. [📄 multerMemory.js - File Upload Middleware](./README-multerMemory.md)
4. [📄 upload.js - API Routes](./README-upload-routes.md)
5. [📄 uploadController.js - Upload Controller](./README-uploadController.md)
6. [📄 ffmpeg.js - Video Transcoding](./README-ffmpeg.md)

---

## 🚀 API Endpoints Quick Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/upload` | Upload video without transcoding |
| POST | `/api/upload/upload-transcode` | Upload and transcode video to HLS |
| GET | `/api/upload/hls/:videoId/:quality/playlist.m3u8` | Get HLS playlist |
| GET | `/api/upload/hls/:videoId/:quality/:segment` | Get HLS video segment |
| GET | `/api/upload/stream/:videoId/:quality?` | Get streaming URL |

---

## 🎓 Key Concepts for Beginners

### 1. What is S3/Wasabi?
Cloud storage services that let you store files on the internet. Like Google Drive but for applications.

### 2. What is a Middleware?
A function that runs between receiving a request and sending a response. It can modify the request, validate data, or handle file uploads.

### 3. What is a Controller?
A file that contains the main logic for handling requests. It decides what to do with the data and what response to send.

### 4. What is a Route?
Defines which URL endpoint triggers which controller function.

### 5. What is FFmpeg?
A powerful command-line tool for processing video and audio. It's like a Swiss Army knife for media files.
