# How to Run the Streaming Automation System

To get the full workflow running (Livestream End -> Transcode -> HLS Playback), you need to run these components simultaneously.

## Prerequisites
1.  **Environment Variables**: Ensure you have a `.env` file with your S3, Redis, and OME credentials. (You can check `.env.example`).
2.  **Infrastructure**:
    - **Redis**: Must be running on default port `6379` (or match your `.env`).
    - **MongoDB**: Must be running (e.g., `mongodb://localhost:27017/video-transcoder`).

## Commands
Open **three** separate terminal windows/tabs:

### 1. Run the Main API Server
This handles the Lesson API and serves the HLS Proxy (so your videos actually play).
```bash
npm run dev
# OR
npm start
```

### 2. Run the Worker
This processes the video transcoding jobs in the background (Fast -> Full).
```bash
npm run worker:dev
# OR
npm run worker
```

### 3. Run the Automate Script (OME Listener)
This listens for the "Stream Stopped" webhook from OME and triggers the workflow.
```bash
node automate.js
```
*(Note: If you have a package.json script for this, use that, otherwise node automate.js is fine)*

## Verification
1.  **Start your Livestream** to your OME server.
2.  **Stop the Livestream**.
3.  **Check Terminal 3 (automate.js)**: You should see "connection close", "uploaded...", and "DONE".
4.  **Check Terminal 2 (Worker)**: You should see "Processing job... (Type: fast)".
5.  **Check Terminal 1 (API)**: You should be able to query the Lesson or access the HLS URL it generated.
