# 🎮 asyncUploadController.js - The V1 Engine

## 📍 Location
`src/controllers/asyncUploadController.js`

---

## 🎯 What Does This File Do?

This is the controller for our **Modern Async API (V1)**. Unlike the legacy controller, this one doesn't make users wait. It works with MongoDB and Redis to manage long-running transcoding tasks.

Main Responsibilities:
1. Receive uploaded files (already in S3).
2. Create a "Job" record in the database.
3. Put that job into the "Queue" for a worker to handle.
4. Let users check the status of their jobs.

---

## 📝 Code Breakdown

### 🔧 Method 1: uploadAndEnqueue
This is called when you `POST /api/upload/v1/upload`.

```javascript
async uploadAndEnqueue(req, res) {
    // 1. Check if file exists
    if (!req.file) return res.status(400).json({ error: 'No video file' });

    // 2. Create a Job in MongoDB
    const job = new Job({
        jobId: uuid(),
        originalFileName: req.file.originalname,
        status: 'queued',
        // ...
    });
    await job.save();

    // 3. Add to Redis Queue
    await addTranscodeJob({ jobId: job.jobId, ... });

    // 4. Return IMMEDIATELY
    return res.status(202).json({ message: 'Queued!', jobId: job.jobId });
}
```

---

### 🔍 Method 2: getJobStatus
Users call this to see if their video is done.

```javascript
async getJobStatus(req, res) {
    const { jobId } = req.params;
    const job = await Job.findOne({ jobId });

    // Return current status and progress percentage (0-100)
    return res.json({
        status: job.status,
        progress: job.progress,
        hlsStreamUrl: job.hlsStreamUrl // Only present if status is 'completed'
    });
}
```

---

### 🔄 Method 3: retryFailedJob
If a transcode fails (e.g., source file was corrupted), users can try again.

```javascript
async retryFailedJob(req, res) {
    const job = await Job.findOne({ jobId });
    if (job.status !== 'failed') return res.error();

    job.status = 'queued'; // Reset status
    await job.save();

    await addTranscodeJob({ ... }); // Add back to queue
}
```

---

## 🧠 Key Concepts

### HTTP 202 Accepted
We return a **202** status code instead of a 200. This is the official web way of saying: "I've received your request and understood it, but I haven't finished the work yet."

### Singleton Pattern
```javascript
export default new AsyncUploadController();
```
We export a `new` instance of the class. This means every file that imports this controller share the same "instance", keeping everything consistent.

---

## 🔗 Related Files

- [upload.js](./README-upload-routes.md) - Calls these methods
- [queue.js](./README-queue-config.md) - Defines the `addTranscodeJob` function
- [Job.js](./README-models.md) - The MongoDB model for storage
