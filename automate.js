import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import crypto from "crypto";
import Job from "./src/models/Job.js";
import connectDB from "./src/config/db.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

connectDB();

// ====== CONFIG ======
const RECORD_ROOT = "/root/ome/records/records";
const OME_API = process.env.OME_API || "http://127.0.0.1:8081";
const OME_TOKEN = process.env.OME_TOKEN || "";
const VHOST = "default";
const APPNAME = "app";

const redis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const uploadQueue = new Queue("upload-queue", { connection: redis });

// ====== HELPERS ======
function omeHeaders() {
    if (!OME_TOKEN) return { "Content-Type": "application/json" };
    const basic = Buffer.from(OME_TOKEN).toString("base64");
    return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}

async function omeStopRecord(recordId) {
    await axios.post(
        `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:stopRecord`,
        { id: recordId },
        { headers: omeHeaders(), timeout: 10000 }
    );
}

async function omeGetRecord(recordId) {
    const res = await axios.post(
        `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:records`,
        { id: recordId },
        { headers: omeHeaders(), timeout: 10000 }
    );
    const d = res.data;
    return d?.response?.[0] || d?.response || d?.records?.[0] || d?.records || d;
}

async function waitUntilStopped(recordId, timeoutMs = 10 * 60 * 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const info = await omeGetRecord(recordId);
        if (Array.isArray(info) && info.length === 0) return null;
        if (!info) return null;
        const state = String(info?.state || info?.status || "").toLowerCase();
        if (state === "stopped" || state === "error" || state === "finished" || state === "ready") return info;
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timeout waiting for recording to stop");
}

function listFilesRecursive(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...listFilesRecursive(p));
        else out.push(p);
    }
    return out;
}

function pickLatestVideoFile(streamFolder) {
    if (!fs.existsSync(streamFolder)) return null;
    const files = listFilesRecursive(streamFolder)
        .filter((f) => /\.(mp4|ts)$/i.test(f))
        .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.f || null;
}

async function getLiveContext(streamName) {
    const raw = await redis.get(`live:${streamName}`);
    return raw ? JSON.parse(raw) : null;
}

async function omeStartRecord(streamName) {
    const recordId = `${streamName}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    await axios.post(
        `${OME_API}/v1/vhosts/${VHOST}/apps/${APPNAME}:startRecord`,
        { id: recordId, stream: { name: streamName } },
        { headers: omeHeaders(), timeout: 10000 }
    );
    return recordId;
}

// ====== WEBHOOK ENDPOINT ======
app.post("/ome/admission", async (req, res) => {
    // Fast response to OME
    res.json({ allowed: true });

    try {
        const request = req.body?.request;
        if (!request || request.direction !== "incoming") return;

        // Extract stream info
        // Example URL: rtmp://72.60.221.204:1935/app/stream_123
        const streamParts = request.url.split('/');
        const streamName = streamParts[streamParts.length - 1];
        if (!streamName) return;

        // ====== ON OPENING ======
        if (request.status === "opening") {
            const lessonId = streamName.split('_')[1] || streamName;

            // Get course metadata from backend
            let courseId = "default";
            try {
                const { data } = await axios.post(`${process.env.BACKEND_URL}/api/lessons/webhook/${lessonId}`, {
                    "SECRET_KEY": process.env.SECRET_KEY
                });
                courseId = data.courseId;
            } catch (err) {
                console.error("[Automate] Metadata fetch failed:", err.message);
            }

            const recordId = await omeStartRecord(streamName);
            await redis.set(
                `live:${streamName}`,
                JSON.stringify({ recordId, lessonId, courseId }),
                "EX", 3600 * 6
            );
            console.log(`[BurstPipeline] Stream starting: ${streamName}, RecordID: ${recordId}`);
            return;
        }

        // ====== ON CLOSING ======
        if (request.status === "closing") {
            const ctx = await getLiveContext(streamName);
            if (!ctx?.recordId) return;

            const { recordId, lessonId, courseId } = ctx;

            console.log(`[BurstPipeline] Stream ending: ${streamName}`);
            await omeStopRecord(recordId);
            await waitUntilStopped(recordId);

            const streamFolder = path.join(RECORD_ROOT, VHOST, APPNAME, streamName);

            // Wait for file arrival
            let localVideo = null;
            for (let i = 0; i < 15; i++) {
                localVideo = pickLatestVideoFile(streamFolder);
                if (localVideo) break;
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!localVideo) {
                console.error(`[BurstPipeline] No video file found for ${streamName}`);
                return;
            }

            const key = `recordings/${courseId}/${lessonId}/${path.basename(localVideo)}`;
            const jobId = crypto.randomUUID();

            // Track job in DB
            await Job.create({
                jobId,
                originalFileName: path.basename(localVideo),
                rawVideoKey: key,
                status: 'queued',
                resolutions: { '360p': { status: 'pending' } }
            });

            // Phase 1: Upload to S3
            await uploadQueue.add("upload-job", {
                jobId,
                localVideo,
                key,
                lessonId,
                courseId,
                streamName,
                originalFileName: path.basename(localVideo)
            });

            await redis.del(`live:${streamName}`);
            console.log(`[BurstPipeline] Enqueued upload phase for ${streamName}`);
            return;
        }

    } catch (e) {
        console.error("[Automate] Webhook error:", e.message);
    }
});

app.listen(3000, () => console.log("Automation Control listening on :3000"));