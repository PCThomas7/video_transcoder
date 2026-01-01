# 🏗️ models/ - Database Structure

## 📍 Location
`src/models/`

---

## 🎯 What Do These Files Do?

In MongoDB, "Models" define what your data looks like. Without them, you could save anything anywhere, which would be very messy. We have two main models:

1. **Job**: Tracks a specific technical task (like "Transcode Video X").
2. **LessonTranscode**: Links a video to a specific **Lesson** in an educational platform.

---

## 📝 1. Job.js (The Task Tracker)

This model tracks the "life" of a transcoding task. 

### Key Fields:
- **`jobId`**: A unique ID (e.g., `abc-123`) used to find this job in the queue.
- **`status`**: Current state. Can be `queued`, `processing`, `completed`, or `failed`.
- **`progress`**: A number from `0` to `100`. Perfect for showing a loading bar to the user!
- **`resolutions`**: Tracks progress for 360p, 720p, etc., individually.
- **`hlsStreamUrl`**: Once finished, this is the link you give to the video player.
- **`error`**: If something goes wrong, we save the error message here.

---

## 📝 2. LessonTranscode.js (The User-Facing Link)

This model connects the technical Job to a real-world Lesson. 

### Key Fields:
- **`lessonId`**: The ID of the lesson from your main platform.
- **`transcodingStatus`**: Similar to Job status, but specific to the lesson (e.g., `processing_low` means the fast version is being made).
- **`hlsUrl`**: The link that the student will use to watch the video.

---

## 🧠 Key Concepts

### What is a Schema?
Think of a **Schema** as a blueprint. It says "Every Job must have a name, and that name must be a String." If you try to save a number as the name, MongoDB (via Mongoose) will stop you and say "Hey, that's not allowed!"

### Timestamps
```javascript
{ timestamps: true }
```
We use this setting so that Mongoose automatically adds `createdAt` (when it was first created) and `updatedAt` (the last time it changed) to every record.

### Why two models?
- If you upload the **same** video for two different lessons, you would have **two** LessonTranscode records but maybe only **one** Job.
- It keeps the "Technical details" (Job) separate from the "Application details" (Lesson).

---

## 🔗 Related Files

- [db.js](./README-db.md) - How we connect to the database
- [asyncUploadController.js](./README-async-controller.md) - Creates these records
- [transcodeWorker.js](./README-queue-worker.md) - Updates these records
