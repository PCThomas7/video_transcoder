# Queue & Worker System Documentation

## Overview
The project uses a producer-consumer architecture powered by **BullMQ** and **Redis** to handle video transcoding tasks asynchronously. This ensures the API server remains responsive even under heavy load.

## Components

### 1. Queue Configuration (`src/config/queue.js`)
- **Queue Name**: `video-transcode`
- **Connection**: Uses `ioredis` to connect to the Redis instance.
- **Retry Logic**: Configured with exponential backoff (retry after 2s, 8s, 32s).
- **Stalled Job Detection**: Automatically detects if a worker crashes and releases the job for retry.
- **Events**: Tracks job lifecycle (added, active, completed, failed) and updates MongoDB.

### 2. Job Lifecycle
1. **Queued**: Job added to Redis. MongoDB status: `queued`.
2. **Active**: Worker picks up job. MongoDB status: `processing`.
3. **Completed**: Transcoding finished. MongoDB status: `completed`.
4. **Failed**: Error occurred. MongoDB status: `failed` (after 3 attempts).

### 3. Worker Process (`src/workers/transcodeWorker.js`)
Runs as a separate process from the API server (`npm run worker`).

**Workflow:**
1. **Connects**: Establishes connections to Redis and MongoDB.
2. **Polls**: Waits for jobs in the `video-transcode` queue.
3. **Process**:
   - Downloads source video from S3 to local temp folder.
   - Runs FFmpeg to transcode into HLS (360p, 480p, 720p, 1080p).
   - Uploads HLS segments (.ts) and playlists (.m3u8) to S3.
   - Cleans up temp files.
4. **Updates**: Reports progress (0-100%) to Redis, which syncs to MongoDB.

**Configuration:**
- `WORKER_CONCURRENCY`: Number of jobs to process in parallel per worker (default: 2).
- `lockDuration`: Time (5m) a job is locked before being considered stalled (prevents false timeouts on long HD videos).

## Scaling
To scale processing power, you can simply run multiple worker instances on different machines, all pointing to the same Redis and S3 setup.

```bash
# On Server A
npm run worker

# On Server B
npm run worker
```
