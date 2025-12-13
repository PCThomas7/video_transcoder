# Async Upload Controller Documentation

## Overview
The `AsyncUploadController` (`src/controllers/asyncUploadController.js`) handles the new v1 API endpoints. Unlike the legacy controller, it does **not** block the request while transcoding.

## Key Features

### 1. Streaming Upload
- Uses `src/middlewares/multerS3.js` to stream incoming files directly to S3.
- **Benefit**: Zero memory footprint on the API server. Capable of handling 5GB+ files even on low-memory servers.

### 2. Asynchronous Response
- **Endpoint**: `POST /api/upload/v1/upload`
- **Behavior**:
  1. File fully uploaded to S3.
  2. Job record created in MongoDB (`queued`).
  3. Job ID added to Redis Queue.
  4. Returns `202 Accepted` immediately.

### 3. Status Tracking
- **Endpoint**: `GET /api/upload/v1/jobs/:jobId/status`
- **Data**: Returns real-time progress, current status, and error details if any.
- **Source**: Reads from MongoDB, which is kept in sync with the worker via Queue Events.

### 4. Retry Mechanism
- **Endpoint**: `POST /api/upload/v1/jobs/:jobId/retry`
- Allows manual retry of failed jobs without re-uploading the video file.

## Performance Optimization
- **Proxy Streaming**: The HLS proxy (`proxyHlsSegment`) pipes S3 data directly to the response instead of buffering.
- **Caching**: Adds `Cache-Control` headers so browsers cache video segments, reducing server load.
