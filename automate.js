import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import crypto from "crypto";
import Job from "./src/models/Job.js";

import LessonTranscode from "./src/models/LessonTranscode.js";
import connectDB from "./src/config/db.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Connect to DB for Lesson updates
connectDB();

// ====== CONFIG ======
const RECORD_ROOT = "/root/ome/records/records"; // <-- your folder root
const OME_API = process.env.OME_API || "http://127.0.0.1:8081"; // OME REST
const OME_TOKEN = process.env.OME_TOKEN || ""; // if your OME uses token auth
const VHOST = "default";
const APPNAME = "app";

console.log(OME_API);
console.log(OME_TOKEN);

// Wasabi S3 (S3-compatible)
const wasabiEndpoint = process.env.WASABI_ENDPOINT || "https://s3.ap-south-1.wasabisys.com";

const s3 = new S3Client({
    region: process.env.WASABI_REGION || "ap-south-1",
    endpoint: wasabiEndpoint.startsWith("http") ? wasabiEndpoint : `https://${wasabiEndpoint}`,
    credentials: {
        accessKeyId: process.env.WASABI_KEY,
        secretAccessKey: process.env.WASABI_SECRET,
    },
    forcePathStyle: true,
});

const BUCKET = process.env.WASABI_BUCKET;
const redis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const transcodeQueue = new Queue("video-transcode", { connection: redis });

// ====== HELPERS ======
function omeHeaders() {
    // Many OME setups use Authorization: Basic <token:>
    // If yours is different, adjust here.
    console.log("ome header is called");
    if (!OME_TOKEN) return { "Content-Type": "application/json" };
    const basic = Buffer.from(OME_TOKEN).toString("base64");
    return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}

async function omeStopRecord(recordId) {
    // Endpoint name can differ by OME version; this is the typical pattern:
    // POST /v1/vhosts/{vhost}/apps/{app}:stopRecord  body: { id: "..." }
    console.log("ome stop recording", recordId);
    await axios.post(
        `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:stopRecord`,
        { id: recordId },
        { headers: omeHeaders(), timeout: 10000 }
    );
}

function makeRecordId(streamName) {
    // short unique id (safe for filenames too)
    return `${streamName}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

async function omeStartRecord(streamName) {
    console.log("ome start record", streamName);

    const recordId = makeRecordId(streamName);

    const payload = {
        id: recordId,                 // ✅ required by your OME
        stream: { name: streamName }, // ✅ required by your OME
    };

    const res = await axios.post(
        `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:startRecord`,
        payload,
        { headers: omeHeaders(), timeout: 10000 }
    );

    console.log("startRecord response:", res.data);

    // In many versions OME just echoes success; safest is return the id we sent
    return recordId;
}
async function omeGetRecord(recordId) {
    // Typical: POST ...:records  body: { id }
    console.log("ome get record", recordId);
    const res = await axios.post(
        `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:records`,
        { id: recordId },
        { headers: omeHeaders(), timeout: 10000 }
    );

    // Different builds return slightly different shapes.
    // Try a few common patterns:
    const d = res.data;
    return d?.response?.[0] || d?.response || d?.records?.[0] || d?.records || d;
}

async function waitUntilStopped(recordId, timeoutMs = 10 * 60 * 1000) {
    const start = Date.now();
    console.log("waiting until stopped", recordId);
    while (Date.now() - start < timeoutMs) {
        const info = await omeGetRecord(recordId);

        // If info is an empty array or list, it means the recording is no longer active (active list is empty)
        if (Array.isArray(info) && info.length === 0) return null;
        if (!info) return null;

        const state = String(info?.state || info?.status || "").toLowerCase();
        console.log(`[DEBUG] RecordId: ${recordId}, State: ${state}, Full Info:`, JSON.stringify(info));

        if (state === "stopped" || state === "error" || state === "finished" || state === "ready") return info;
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timeout waiting for recording to stop");
}

function listFilesRecursive(dir) {
    console.log("list files ", dir);
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...listFilesRecursive(p));
        else out.push(p);
    }
    return out;
}

function pickLatestVideoFile(streamFolder) {
    console.log("pick stream folder", streamFolder);
    if (!fs.existsSync(streamFolder)) return null;

    // Look for mp4 first, otherwise ts.
    const files = listFilesRecursive(streamFolder)
        .filter((f) => /\.(mp4|ts)$/i.test(f))
        .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    return files[0]?.f || null;
}

async function uploadToWasabi(localFilePath, key) {
    console.log("uploading to wasabi");
    const body = fs.createReadStream(localFilePath);
    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: body,
            ContentType: localFilePath.toLowerCase().endsWith(".mp4")
                ? "video/mp4"
                : "video/MP2T",
        })
    );
    // Return a stable reference for workers (better than public URL)
    return { bucket: BUCKET, key };
}

// ====== IMPORTANT: you must implement mapping streamName -> recordId + lessonId ======
// simplest: store in Redis/DB when you START recording
async function getLiveContext(streamName) {
    console.log("get live context", streamName);
    const raw = await redis.get(`live:${streamName}`);
    return raw ? JSON.parse(raw) : null;
}

// ====== WEBHOOK ENDPOINT ======
app.post("/ome/admission", async (req, res) => {
    console.log("endpoint is called");
    console.log(JSON.stringify(req.body, null, 2));

    // must respond fast
    res.json({ allowed: true });

    try {
        const request = req.body?.request;
        if (!request) return;

        if (request.direction !== "incoming") return;

        const streamName = request.url.split('rtmp://72.60.221.204:1935/app/')[1];
        console.log(streamName);
        if (!streamName) return;

        // ====== ON OPENING: start recording + save recordId ======
        if (request.status === "opening") {
            // start record and store in redis
            console.log("connect open");
            const recordId = await omeStartRecord(streamName);
            console.log("record id", recordId);
            await redis.set(
                `live:${streamName}`,
                JSON.stringify({ recordId, lessonId: null }),
                "EX",
                60 * 60 * 6 // keep up to 6 hours
            );

            console.log("Recording started:", streamName, recordId);
            return;
        }

        // ====== ON CLOSING: stop recording + upload + enqueue ======
        if (request.status === "closing") {
            console.log("connection close");
            const ctx = await getLiveContext(streamName);
            console.log("ctx: ", ctx);
            if (!ctx?.recordId) {
                console.log("No ctx/recordId for stream:", streamName);
                return;
            }

            const { recordId, lessonId } = ctx;

            await omeStopRecord(recordId);
            await waitUntilStopped(recordId);

            const streamFolder = path.join(RECORD_ROOT, VHOST, APPNAME, streamName);

            // Retry finding the file (handling potential race conditions where FS is slow)
            async function waitForFile(folder, durationMs = 30000) {
                const start = Date.now();
                while (Date.now() - start < durationMs) {
                    const f = pickLatestVideoFile(folder);
                    if (f) return f;
                    console.log(`[WaitFile] No file yet in ${folder}, retrying...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
                return null;
            }

            const localVideo = await waitForFile(streamFolder);
            if (!localVideo) throw new Error(`No mp4/ts found in ${streamFolder} after waiting`);

            const key = `recordings/${VHOST}/${APPNAME}/${streamName}/${path.basename(localVideo)}`;
            const s3ref = await uploadToWasabi(localVideo, key);

            // Update Lesson with Raw Video URL
            // Use existing lessonId from context if available, otherwise use streamName
            const effectiveLessonId = lessonId || streamName;

            // Create/Update Lesson with Raw URL
            try {
                await LessonTranscode.findOneAndUpdate(
                    { lessonId: effectiveLessonId },
                    {
                        videoUrl: `https://${BUCKET}.s3.${s3.config.region}.wasabisys.com/${key}`,
                        transcodingStatus: 'pending' // Ready for transcoding
                    },
                    { upsert: true }
                );
            } catch (err) {
                console.error("Failed to update Lesson model:", err);
            }

            // Create Job ID
            const jobId = crypto.randomUUID();

            // Create Job Record
            try {
                await Job.create({
                    jobId,
                    originalFileName: path.basename(localVideo),
                    rawVideoKey: key,
                    status: 'queued',
                    resolutions: {
                        '360p': { status: 'pending' },
                        '480p': { status: 'pending' },
                        '720p': { status: 'pending' },
                        '1080p': { status: 'pending' }
                    }
                });
            } catch (err) {
                console.error("Failed to create Job record:", err);
            }

            await transcodeQueue.add("transcode", {
                jobId,
                lessonId: effectiveLessonId,
                streamName,
                originalFileName: path.basename(localVideo),
                rawVideoKey: key,
                transcodeType: "fast", // <--- Trigger Fast Transcode
                input: s3ref,
                outputPrefix: `vod/${VHOST}/${APPNAME}/${streamName}/`,
            });

            await redis.del(`live:${streamName}`);
            console.log("DONE:", streamName, "uploaded:", s3ref);
            return;
        }

        console.log("Ignored status:", request.status);
    } catch (e) {
        console.error("Webhook error:", e || e?.message);
    }
});

app.listen(3000, () => console.log("Control server listening on :3000"));