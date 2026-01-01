# 🛣️ upload.js - API Routes

## 📍 Location
`src/routes/upload.js`

---

## 🎯 What Does This File Do?

This file defines the **URLs (endpoints)** that users and players can call. It acts like a receptionist, taking incoming requests and directing them to the right controller function.

We have two "versions" of the API:
1. **V1 (Async)**: Recommended for users. Uploads quickly and transcodes in the background.
2. **Legacy (Sync)**: Older version. Blocks the user until transcoding is 100% finished.

---

## 📝 API Endpoints Summary

### 🚀 V1 API (Recommended)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload/v1/upload` | Upload video & queue for transcoding |
| `GET` | `/api/upload/v1/jobs/:jobId/status` | Check if a video is done transcoding |
| `GET` | `/api/upload/v1/jobs` | List all historical transcoding jobs |
| `POST` | `/api/upload/v1/jobs/:jobId/retry` | Restart a failed job |
| `GET` | `/api/upload/v1/queue/stats` | See how many jobs are in the queue |

### 🛠️ Legacy API
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload/upload` | Direct upload (No transcoding) |
| `POST` | `/api/upload/upload-transcode` | Upload & Transcode (Blocks until finished) |

### 📺 Streaming & Proxying
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/upload/hls/.../master.m3u8` | Get the master HLS playlist |
| `GET` | `/api/upload/hls/.../playlist.m3u8` | Get quality-specific HLS playlist |
| `GET` | `/api/upload/stream/...` | Get a playable proxy URL |

---

## 📝 Code Breakdown

### 1. The Async Upload Route
```javascript
router.post('/v1/upload',
    uploadToS3.single('video'),
    asyncUploadController.uploadAndEnqueue.bind(asyncUploadController)
);
```
**Step-by-Step:**
1. **`router.post`**: This only works for `POST` requests (sending data).
2. **`uploadToS3.single('video')`**: This is a middleware. Before our controller even starts, this middleware takes the file from the request and uploads it directly to S3.
3. **`asyncUploadController`**: Once the file is safe in S3, this controller creates a background job in Redis and returns a `202 Accepted` status to the user immediately.

---

### 2. The HLS Proxy Routes
These are special routes that allow players to watch videos stored in a **private** S3 bucket.

```javascript
router.get('/hls/:courseId/:lessonId/:videoId/master.m3u8',
    uploadController.proxyHlsMaster.bind(uploadController)
);
```
**How it works:**
1. The video player asks for `master.m3u8`.
2. Our server fetches it from S3.
3. Our server "rewrites" the file to make sure the player comes back to us for the next pieces (segments).
4. This keeps the S3 credentials safe on the server!

---

## 🧠 Key Concepts

### What is `router.get` vs `router.post`?
- **`GET`**: Used for fetching information (like "Give me the status").
- **`POST`**: Used for sending information or performing actions (like "Upload this file").

### Route Parameters (`:jobId`, `:videoId`)
When you see a colon like `:jobId`, it means that part of the URL is dynamic.
- URL: `/api/upload/v1/jobs/123-abc/status`
- In the code: `req.params.jobId` will be `"123-abc"`.

### .bind(controller)
Inside classes, we use `.bind()` to make sure the keyword `this` still works correctly. Without it, the controller might lose track of its own properties.

---

## 🔗 Related Files

- [asyncUploadController.js](./README-async-controller.md) - Logic for the V1 API
- [uploadController.js](./README-uploadController.md) - Logic for Legacy and Proxy API
- [multerS3.js](./README-multerS3.md) - The tool that uploads to S3
- [index.js](./README-index.md) - Mounts this router
