# Beginner's Guide to `automate.js` (With Code)

This guide takes you through the `automate.js` file step-by-step, explaining what each part of the code actually does.

---

## 1. The Setup (Imports & Configuration)

First, we import the necessary tools. Think of these as the "ingredients" for our automation recipe.

```javascript
import express from "express";       // The web server framework
import axios from "axios";           // To make HTTP requests (like clicking a link in code)
import { S3Client } from "@aws-sdk/client-s3"; // To talk to our storage bucket
import { Queue } from "bullmq";      // To manage background jobs
import IORedis from "ioredis";       // The shared memory/database
```

We also set up our connections to **Wasabi S3** (where videos will live) and **Redis** (our temporary memory).

```javascript
// Configure the cloud storage file uploader
const s3 = new S3Client({
    region: process.env.WASABI_REGION || "ap-south-1",
    credentials: {
        accessKeyId: process.env.WASABI_KEY,
        secretAccessKey: process.env.WASABI_SECRET,
    },
    // We use 'forcePathStyle' for Wasabi/MinIO usually
    endpoint: wasabiEndpoint, 
});

// Configure the redis connection
const redis = new IORedis(process.env.REDIS_URL);

// Create the job queue explicitly for 'transcode' tasks
const transcodeQueue = new Queue("transcode", { connection: redis });
```

---

## 2. The Main Trigger: Webhook (`/ome/admission`)

This is the heart of the automation. **OvenMediaEngine (OME)** calls this URL whenever a streamer connects or disconnects.

```javascript
app.post("/ome/admission", async (req, res) => {
    // 1. We immediately say "OK" so the server doesn't wait.
    res.json({ allowed: true });

    const request = req.body?.request;
    
    // We only care about incoming RTMP/WebRTC streams
    if (request.direction !== "incoming") return;
    
    // 2. Extract the unique stream name. 
    // WARNING: This splits by the specific Server IP/URL. If your server IP changes, this line needs update.
    const streamName = request.url.split('rtmp://72.60.221.204:1935/app/')[1];
```

---

## 3. When a Stream Starts (`opening`)

When a user starts streaming, we want to tell the media server to **start recording** immediately.

```javascript
    if (request.status === "opening") {
        console.log("connect open");
        
        // 1. Call our helper function to tell OME "Start Recording!"
        const recordId = await omeStartRecord(streamName);
        
        // 2. Save this information in Redis so we remember it later.
        // We map "live:streamName" -> { recordId: "..." }
        await redis.set(
            `live:${streamName}`,
            JSON.stringify({ recordId, lessonId: null }),
            "EX",
            60 * 60 * 6 // Expire after 6 hours just in case
        );
    }
```

**What `omeStartRecord` does:**
It sends a POST request to OME's API.
```javascript
// from omeStartRecord() function
await axios.post(
    `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:startRecord`,
    { id: recordId, stream: { name: streamName } },
    { headers: omeHeaders() }
);
```

---

## 4. When a Stream Ends (`closing`)

This is where the heavy lifting happens. When they stop, we have to finish the recording, upload it, and start the transcoding job.

```javascript
    if (request.status === "closing") {
        // 1. Retrieve the recording ID we saved earlier
        const ctx = await getLiveContext(streamName);
        const { recordId } = ctx;

        // 2. Tell OME to stop recording
        await omeStopRecord(recordId);

        // 3. WAIT. It takes a moment for the file to be written to disk.
        // We poll the API until it says "stopped" or "finished".
        await waitUntilStopped(recordId);

        // 4. Find the actual .mp4 or .ts file on the hard drive.
        const streamFolder = path.join(RECORD_ROOT, VHOST, APPNAME, streamName);
        
        // Use a retry loop to find the file (sometimes file system is slow)
        const localVideo = await waitForFile(streamFolder); 
        
        // 5. Upload that file to the cloud (Wasabi).
        const key = `recordings/${VHOST}/${APPNAME}/${streamName}/${path.basename(localVideo)}`;
        const s3ref = await uploadToWasabi(localVideo, key);

        // 6. Finally, create a "Job" for the workers.
        // This puts a message in the 'transcode' queue.
        await transcodeQueue.add("transcode", {
            streamName,
            input: s3ref, // "Here is the file I just uploaded"
            outputPrefix: `vod/.../`,
            profiles: ["360p", "480p", "720p"], // "Make these versions"
        });
        
        // Cleanup Redis
        await redis.del(`live:${streamName}`);
    }
```

---

## 5. Helper Functions

These support the main logic above.

### `uploadToWasabi`
Takes a file from your computer and pushes it to the generic S3 bucket.

```javascript
async function uploadToWasabi(localFilePath, key) {
    const body = fs.createReadStream(localFilePath); // Open the file
    
    // Send the "PutObject" command to S3
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "video/mp4" 
    }));
}
```

### `waitUntilStopped`
This is a loop that keeps asking "Are you done?"

```javascript
async function waitUntilStopped(recordId) {
    while (true) {
        const info = await omeGetRecord(recordId);
        // If status is 'stopped' or 'finished', we can proceed.
        if (state === "stopped" || state === "finished") return info;
        
        // Otherwise, wait 2 seconds and ask again.
        await new Promise((r) => setTimeout(r, 2000));
    }
}
```

### `pickLatestVideoFile` & `waitForFile`
Finding the file can be tricky. We might check before the OS has finished saving it.

1.  **`pickLatestVideoFile`**: Scans the folder. It prefers `.mp4` but will take `.ts`. It always picks the **newest** one.
2.  **`waitForFile`**: Calls `pickLatestVideoFile`. If it finds nothing, it waits 2 seconds and tries again, repeating this for up to 30 seconds.

```javascript
function pickLatestVideoFile(streamFolder) {
    // Get all files, filter for mp4/ts, sort by time (newest first)
    const files = listFilesRecursive(streamFolder)
        .filter((f) => /\.(mp4|ts)$/i.test(f))
        .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.f || null;
}
```

## Summary

1.  **Listen**: `app.post` waits for OME signals.
2.  **Start**: On `opening`, call start API & save ID to Redis.
3.  **End**: On `closing`, call stop API, wait for file, upload to S3, and trigger a transcode job.
