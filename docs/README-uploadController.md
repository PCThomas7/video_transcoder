# 🎮 uploadController.js - Main Application Logic

## 📍 Location
`src/controllers/uploadController.js`

---

## 🎯 What Does This File Do?

This is the **brain** of the application. It contains all the logic for:
1. Uploading videos to S3
2. Transcoding videos to HLS format
3. Proxying HLS streams for private bucket access
4. Generating streaming URLs

---

## 📝 Class Structure

```javascript
class UploadController {
    async uploadVideo(req, res) { ... }
    async uploadAndTranscode(req, res) { ... }
    async proxyHlsPlaylist(req, res) { ... }
    async proxyHlsSegment(req, res) { ... }
    async getStreamUrl(req, res) { ... }
}

export default new UploadController();
```

The controller is a **class** with methods for each action. We export a **single instance** (singleton pattern).

---

## 🔧 Method 1: uploadVideo

```javascript
async uploadVideo(req, res) {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }
        const fileName = `${uuid()}-${req.file.originalname}`;
        const params = {
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        };

        const uploadResult = await s3.upload(params).promise();
        const videoUrl = uploadResult.Location;

        return res.status(200).json({
            message: 'Video uploaded successfully',
            videoUrl,
            hlsPlaylistUrl: `${videoUrl.replace(/\.[^/.]+$/, '')}/360p/index.m3u8`
        });
    } catch (error) {
        console.error('Error uploading video:', error);
        return res.status(500).send('Error uploading video.');
    }
}
```

### Step-by-Step Breakdown

```
┌─────────────────────────────────────────────────────────────────────┐
│                            FLOW                                      │
└─────────────────────────────────────────────────────────────────────┘

1. CHECK FILE EXISTS
   ├── if (!req.file) → 400 Error
   └── Continue if file exists

2. CREATE UNIQUE FILENAME
   └── uuid() + originalname
   └── Example: "abc123-myvideo.mp4"

3. PREPARE S3 UPLOAD PARAMS
   ├── Bucket: Your S3 bucket name
   ├── Key: The filename in S3
   ├── Body: The file content (buffer)
   └── ContentType: video/mp4, etc.

4. UPLOAD TO S3
   └── s3.upload(params).promise()

5. SEND RESPONSE
   ├── videoUrl: Direct link to uploaded file
   └── hlsPlaylistUrl: Expected HLS location
```

---

## 🔧 Method 2: uploadAndTranscode (The Main Feature!)

This is the most important method. Let's break it down:

### Phase 1: Initial Upload
```javascript
const fileName = `${uuid()}-${req.file.originalname}`;
const uploadResult = await s3.upload(params).promise();
```
Uploads the original video to S3.

### Phase 2: Create Temp Directory
```javascript
tempDir = path.join(os.tmpdir(), `transcode-${uuid()}`);
await fs.mkdir(tempDir, { recursive: true });
tempVideoPath = path.join(tempDir, `input-${uuid()}...`);
await fs.writeFile(tempVideoPath, req.file.buffer);
```
- Creates a temporary folder on the server
- Writes the video buffer to a file (FFmpeg needs a file path)

### Phase 3: Transcode Video
```javascript
await transcodeVideo(tempVideoPath, tempDir);
```
Calls FFmpeg to create HLS versions in 360p, 480p, 720p, 1080p.

### Phase 4: Upload HLS Files to S3
```javascript
const uploadFolderToS3 = async (localDir, s3Prefix) => {
    const entries = await fs.readdir(localDir, { withFileTypes: true });
    for (const entry of entries) {
        // ... recursively upload all files
    }
};
await uploadFolderToS3(tempDir, hlsPrefix);
```
Uploads the entire transcoded folder structure to S3.

### Phase 5: Generate Response
```javascript
return res.status(200).json({
    videoUrl: videoSignedUrl,
    hlsPlaylistUrl: hlsPlaylistSignedUrl,
    hlsStreamUrl: hlsProxyUrl,
    videoId: hlsPrefix,
    hlsSegments: segments,
    expiresIn: '24 hours',
});
```

### Phase 6: Cleanup
```javascript
finally {
    await fs.unlink(tempVideoPath);
    await fs.rm(tempDir, { recursive: true, force: true });
}
```
Deletes temporary files even if an error occurred.

---

## 🔄 Complete Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                     uploadAndTranscode FLOW                             │
└────────────────────────────────────────────────────────────────────────┘

Request arrives with video file
         │
         ▼
┌─────────────────────┐
│ 1. UPLOAD ORIGINAL  │
│    TO S3            │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 2. SAVE TO TEMP     │
│    FILE             │
│    (needed for ffmpeg)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 3. TRANSCODE        │
│    WITH FFMPEG      │
│                     │
│    Creates:         │
│    └── 360p/        │
│        ├── index.m3u8
│        └── segment*.ts
│    └── 480p/        │
│    └── 720p/        │
│    └── 1080p/       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 4. UPLOAD HLS       │
│    FOLDER TO S3     │
│                     │
│    All .m3u8 and    │
│    .ts files        │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 5. GENERATE URLS    │
│    - Signed URLs    │
│    - Proxy URLs     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 6. CLEANUP          │
│    Delete temp files│
└─────────┬───────────┘
          │
          ▼
    Return Response
```

---

## 🔧 Method 3: proxyHlsPlaylist

```javascript
async proxyHlsPlaylist(req, res) {
    const { videoId, quality } = req.params;
    const key = `${videoId}/${quality}/index.m3u8`;
    
    // Fetch playlist from S3
    const data = await s3.getObject(params).promise();
    let playlistContent = data.Body.toString('utf-8');
    
    // Rewrite URLs to point to our proxy
    playlistContent = playlistContent.replace(
        /^(segment\d+\.ts)$/gm,
        `${baseUrl}/api/upload/hls/${videoId}/${quality}/$1`
    );
    
    res.send(playlistContent);
}
```

### Why Do We Need This?

**Problem:** Videos in private S3 buckets can't be accessed directly by video players.

**Solution:** Our server acts as a middleman:
1. Video player requests playlist from our server
2. Our server fetches it from S3 (we have credentials)
3. We modify the playlist to point segment URLs back to our server
4. Video player gets segments through our server too

```
Original playlist:
  segment000.ts
  segment001.ts
  segment002.ts

Modified playlist:
  http://ourserver.com/api/upload/hls/video123/360p/segment000.ts
  http://ourserver.com/api/upload/hls/video123/360p/segment001.ts
  http://ourserver.com/api/upload/hls/video123/360p/segment002.ts
```

---

## 🔧 Method 4: proxyHlsSegment

```javascript
async proxyHlsSegment(req, res) {
    const { videoId, quality, segment } = req.params;
    const key = `${videoId}/${quality}/${segment}`;
    
    const data = await s3.getObject(params).promise();
    
    res.setHeader('Content-Type', 'video/MP2T');
    return res.send(data.Body);
}
```

Simply fetches a video segment from S3 and streams it to the client.

---

## 🔧 Method 5: getStreamUrl

```javascript
async getStreamUrl(req, res) {
    const { videoId, quality } = req.params;
    const hlsProxyUrl = `${baseUrl}/api/upload/hls/${videoId}/${quality || '360p'}/playlist.m3u8`;
    
    return res.json({
        hlsPlaylistUrl: hlsProxyUrl,
        message: 'Use this URL with an HLS player'
    });
}
```

Returns the proxy URL for a video. Useful for getting a playable URL.

---

## 🧠 Key Concepts

### What is UUID?
**UUID** (Universally Unique Identifier) generates random unique strings:
```javascript
uuid() // 'a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6'
```
This prevents filename collisions when multiple users upload `video.mp4`.

### What is async/await?
```javascript
// ❌ Without async/await (callback hell)
s3.upload(params, (err, data) => {
    if (err) handleError(err);
    else doSomethingWith(data);
});

// ✅ With async/await (clean and readable)
const result = await s3.upload(params).promise();
doSomethingWith(result);
```

### What is try/catch/finally?
```javascript
try {
    // Code that might fail
    await riskyOperation();
} catch (error) {
    // Handle the error
    console.error(error);
} finally {
    // Always runs, even if error occurred
    cleanup();
}
```

### Why Use a Class?
```javascript
class UploadController { ... }
export default new UploadController();
```

Benefits:
- Organizes related methods together
- Allows sharing state between methods
- Single instance ensures consistency

---

## 📄 Response Examples

### Upload Success
```json
{
    "message": "Video uploaded and transcoded successfully",
    "videoUrl": "https://bucket.s3.wasabisys.com/video.mp4?signature=...",
    "hlsPlaylistUrl": "https://bucket.s3.wasabisys.com/.../360p/index.m3u8?signature=...",
    "hlsStreamUrl": "http://localhost:2000/api/upload/hls/abc123/360p/playlist.m3u8",
    "videoId": "abc123-myvideo",
    "hlsSegments": [...],
    "expiresIn": "24 hours"
}
```

### Error Response
```json
{
    "error": "Error uploading/transcoding video."
}
```

---

## 🔗 Related Files

This file uses:
- [aws.js](./README-aws.md) - S3 client and getSignedUrl function
- [ffmpeg.js](./README-ffmpeg.md) - Video transcoding function

This file is used by:
- [upload.js](./README-upload-routes.md) - Routes call these methods
