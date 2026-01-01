# 👷 transcodeWorker.js - The Background Worker

## 📍 Location
`src/workers/transcodeWorker.js`

---

## 🎯 What Does This File Do?

The **Worker** is a separate process that does the "heavy lifting". It sits and waits for jobs to appear in the Redis queue. When a job arrives, it:
1. Downloads the original video from S3.
2. Runs FFmpeg to transcode it.
3. Uploads the finished HLS files back to S3.
4. Notifies the database and (optionally) a webhook.

---

## 📝 The Job Lifecycle

When this worker processes a job, it follows these exact steps:

### 1. Download Phase
```javascript
inputVideoPath = path.join(tempDir, `input${ext}`);
await downloadFromS3(s3Client, bucket, rawVideoKey, inputVideoPath);
```
First, it downloads the large video file from S3 to a temporary folder on the server's hard drive. FFmpeg works much faster on local files than on streams.

### 2. Transcoding Phase
```javascript
await transcodeVideo(inputVideoPath, tempDir, { targetResolutions, ... });
```
This is where the magic happens. It calls our FFmpeg utility.
- **Fast Mode**: Only generates 360p (so the user can watch immediately).
- **Full Mode**: Generates 360p, 480p, 720p, and 1080p.

### 3. Upload Phase
```javascript
await uploadFolderToS3(s3Client, bucket, tempDir, hlsPrefix);
```
Once FFmpeg is done, it takes the hundreds of tiny `.ts` segments and the `.m3u8` playlists and uploads them to S3.

### 4. Notification Phase
```javascript
await axios.post(`${process.env.BACKEND_URL}/api/lessons/webhook/update-video`, {
    lessonId,
    hlsUrl: hlsStreamUrl,
});
```
If a `lessonId` was provided, the worker sends a "Webhook" (an automated API call) to the main backend to say "Hey! The video for this lesson is ready to be watched!"

### 5. Cleanup Phase
```javascript
await fs.rm(tempDir, { recursive: true, force: true });
```
Finally, it deletes the temporary files of the hard drive to save space.

---

## 🚀 "Fast" vs "Full" Transcoding

We use a two-stage process for the best user experience:

1. **Phase 1: FAST**
   - Goal: Get the video playable ASAP.
   - Task: Transcode ONLY to 360p.
   - Result: User can watch the video in ~30 seconds.
   - *Once done, the worker automatically adds a NEW job for Phase 2.*

2. **Phase 2: FULL**
   - Goal: Add high-quality options.
   - Task: Transcode 480p, 720p, and 1080p.
   - Result: User can now switch to HD mode.

---

## 🧠 Key Concepts

### Concurrency
```javascript
concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2
```
This tells the worker how many videos to transcode **at the same time**. 
- If set to 1, it does them one by one.
- If set to 4, it uses more CPU but finishes more videos at once.

### Lock Duration
Transcoding is slow. This worker "locks" the job for 5 minutes. This tells other workers "Don't touch this, I'm already working on it!"

---

## 🔗 Related Files

- [queue.js](./README-queue-config.md) - Where the jobs come from
- [ffmpeg.js](./README-ffmpeg.md) - The tool used for step 2
- [Job.js](./README-models.md) - Where progress is recorded
