# 📥 queue.js - Job Queue Configuration

## 📍 Location
`src/config/queue.js`

---

## 🎯 What Does This File Do?

This file sets up the **Background Job Queue**. 

**Why do we need a queue?**
Transcoding a video takes a long time (sometimes minutes). If we made the user wait for the transcode to finish before sending a response, their browser would "time out". Instead, we:
1. Receive the file.
2. Put a "job" in the queue.
3. Tell the user "We're working on it! Here's your Job ID."
4. A separate worker picks up the job and finishes it in the background.

---

## 📝 Code Breakdown

### 1. Redis Connection
```javascript
const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    // ...
};
export const redisConnection = new IORedis(redisConfig);
```
**Redis** is the "storage" for our queue. BullMQ (the library we use) uses Redis to remember which jobs are waiting, which are currently being worked on, and which failed.

---

### 2. Defining the Queue
```javascript
export const transcodeQueue = new Queue('video-transcode', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3, // Retry 3 times if it fails
        backoff: { type: 'exponential', delay: 2000 }, // Wait longer between retries
        removeOnComplete: { age: 86400 } // Delete old logs after 24 hours
    }
});
```
We create a queue named `video-transcode`. We configure it to automatically retry if it fails.

---

### 3. Event Listeners (initQueueEvents)
This function sets up "listeners" that watch for changes in job status.

#### `active` Event:
```javascript
queueEvents.on('active', async ({ jobId }) => {
    await Job.findOneAndUpdate({ jobId }, { status: 'processing' });
});
```
When a worker starts working on a job, we update the status in our MongoDB database to `"processing"`.

#### `progress` Event:
```javascript
queueEvents.on('progress', async ({ jobId, data }) => {
    await Job.findOneAndUpdate({ jobId }, { progress: data });
});
```
When FFmpeg finishes 10%, 20%, etc., it sends a progress update. We save this to the database so the user can see a loading bar.

#### `completed` Event:
```javascript
queueEvents.on('completed', async ({ jobId, returnvalue }) => {
    await Job.findOneAndUpdate({ jobId }, { status: 'completed', progress: 100 });
});
```
When it's finally done, we mark it as `"completed"`.

---

## 🧠 Key Concepts

### What is BullMQ?
BullMQ is a powerful library for Node.js that handles message queues. It's built on top of Redis and handles complex things like retries, delays, and priority automatically.

### Background vs. Foreground
- **Foreground (Express)**: Quick tasks (checking login, sending static text).
- **Background (Queue)**: Heavy tasks (image processing, video transcoding, sending 10,000 emails).

---

## 🔗 Related Files

- [index.js](./README-index.md) - Initializes the queue events
- [transcodeWorker.js](./README-queue-worker.md) - The "Worker" that actually does the work
- [Job.js](./README-models.md) - The database model for jobs
