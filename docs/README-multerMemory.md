# 📦 multerMemory.js - File Upload Middleware

## 📍 Location
`src/middlewares/multerMemory.js`

---

## 🎯 What Does This File Do?

This file configures **Multer** to handle file uploads. When a user uploads a video, Multer:

1. Receives the file from the HTTP request
2. Stores it temporarily in **memory** (RAM)
3. Makes it available to the controller as `req.file`

---

## 📝 Code Breakdown

```javascript
import multer from 'multer'

const multerMemory = multer({
    storage: multer.memoryStorage(),
})

export default multerMemory;
```

### What's Happening Here?

| Line | Explanation |
|------|-------------|
| `import multer from 'multer'` | Import the Multer library for handling file uploads |
| `multer.memoryStorage()` | Store uploaded files in RAM (memory), not on disk |
| `multer({ storage: ... })` | Create a Multer instance with memory storage |
| `export default multerMemory` | Export so other files can use it |

---

## 🧠 Understanding Multer Storage Options

Multer offers two main storage options:

### 1. Memory Storage (What We Use)
```javascript
multer.memoryStorage()
```
- ✅ File is stored in RAM as a Buffer
- ✅ Fast access
- ✅ No disk writes
- ❌ Uses more RAM
- ❌ Large files can crash the server if RAM is limited

### 2. Disk Storage (Alternative)
```javascript
multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, file.originalname)
    }
})
```
- ✅ Doesn't use RAM
- ✅ Good for large files
- ❌ Slower (disk I/O)
- ❌ Need to manage file cleanup

---

## 🔄 How Multer Works in the Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Client (Browser/App)                            │
│                                                                  │
│   POST /api/upload/upload-transcode                             │
│   Content-Type: multipart/form-data                             │
│   Body: { video: [binary file data] }                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express Server                               │
│                                                                  │
│   1. Request arrives at route                                   │
│                                                                  │
│   router.post('/upload-transcode',                              │
│       multerMemory.single('video'),  ◄── MULTER RUNS HERE       │
│       uploadController.uploadAndTranscode                       │
│   )                                                             │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Multer Processing                              │
│                                                                  │
│   1. Reads the multipart/form-data                              │
│   2. Finds the field named 'video'                              │
│   3. Stores file content in memory (Buffer)                     │
│   4. Attaches file info to req.file                             │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Controller Access                              │
│                                                                  │
│   req.file = {                                                  │
│       fieldname: 'video',                                       │
│       originalname: 'myvideo.mp4',                              │
│       mimetype: 'video/mp4',                                    │
│       buffer: <Buffer 00 00 00 ...>,  ◄── THE FILE CONTENT     │
│       size: 12345678                                            │
│   }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 The `req.file` Object

After Multer processes the upload, `req.file` contains:

| Property | Description | Example |
|----------|-------------|---------|
| `fieldname` | Name of the form field | `'video'` |
| `originalname` | Original filename from user's computer | `'vacation.mp4'` |
| `encoding` | Encoding type | `'7bit'` |
| `mimetype` | MIME type of the file | `'video/mp4'` |
| `buffer` | **The actual file content** (binary data) | `<Buffer 00 00 00 18 ...>` |
| `size` | File size in bytes | `15728640` (15MB) |

---

## 💡 Usage in Routes

```javascript
// In upload.js routes file
import multerMemory from '../middlewares/multerMemory.js'

// .single('video') means: expect ONE file in the 'video' field
router.post('/upload', multerMemory.single('video'), controller.uploadVideo)
```

### Multer Methods

| Method | Description |
|--------|-------------|
| `.single('fieldname')` | Accept a single file in the specified field |
| `.array('fieldname', maxCount)` | Accept multiple files in one field |
| `.fields([{name: 'a'}, {name: 'b'}])` | Accept files from multiple fields |
| `.none()` | Accept only text fields |
| `.any()` | Accept any files |

---

## 🧠 Key Concepts

### What is Middleware?
Middleware is a function that runs between receiving a request and sending a response. Multer acts as middleware to process file uploads before your controller code runs.

### What is a Buffer?
A **Buffer** is how Node.js handles binary data. It's like an array of bytes. When you read an image or video file, you get a Buffer.

```javascript
// The buffer is the actual file content
const fileContent = req.file.buffer; // <Buffer 00 00 00 18 66 74 79 70 ...>

// You can write it to a file
fs.writeFileSync('output.mp4', fileContent);

// Or upload it to S3
s3.upload({ Body: fileContent, ... })
```

### What is multipart/form-data?
When you upload files via HTML forms, the browser sends them as `multipart/form-data`. This format allows sending both text fields and binary files together.

---

## ⚠️ Important Considerations

### Memory Usage
Since we use memory storage, large videos consume RAM:
- 100MB video = 100MB RAM usage
- Multiple simultaneous uploads multiply this

### Solution for Large Files
For production with large files, consider:
1. Using disk storage
2. Streaming uploads directly to S3
3. Setting file size limits:

```javascript
const multerMemory = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    }
})
```

---

## 🔗 Related Files

This middleware is used by:
- [upload.js](./README-upload-routes.md) - Attaches Multer to routes
- [uploadController.js](./README-uploadController.md) - Accesses `req.file.buffer`
