# 📤 multerS3.js - Streaming to the Cloud

## 📍 Location
`src/middlewares/multerS3.js`

---

## 🎯 What Does This File Do?

When a user uploads a 1GB video, we don't want to save it to our server first. That would waste disk space and make the process slow. 

Instead, we use **Streaming**. This file configures the server to "pipe" the incoming data from the user directly into **Wasabi/S3 storage**. 

---

## 📝 Code Breakdown

### 1. The S3 Client (v3)
```javascript
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    endpoint: `https://${process.env.WASABI_ENDPOINT}`,
    // ...
});
```
We create a connection tool specifically for the newer version of the AWS SDK (v3). It's configured to talk to Wasabi using our secret keys.

### 2. Multer-S3 Storage
```javascript
const s3Storage = multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    key: (req, file, cb) => {
        const uniqueId = uuid();
        const key = `raw-videos/${uniqueId}-${file.originalname}`;
        cb(null, key);
    }
});
```
This is the "brain" of our streaming setup:
- **`bucket`**: Which storage container to use.
- **`key`**: A function that decides the filename in S3. We use `uuid()` to ensure that even if two users upload `video.mp4`, they won't overwrite each other.
- **`req.videoKey`**: We save the filename inside the `req` (request) object so our controller can find it later.

---

### 3. The File Filter
```javascript
const videoFileFilter = (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/webm', ...];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true); // Accept file
    } else {
        cb(new Error('Invalid file type'), false); // Reject file
    }
};
```
We security-check the file. If someone tries to upload a `.exe` or a `.php` file, we block it. Only video files are allowed!

---

## 🧠 Key Concepts

### What is Streaming?
Imagine trying to move water from one bucket to another using a small cup (RAM). 
- **Without Streaming**: You fill the server's RAM with the whole 1GB file, then send it to S3. (CRASH!)
- **With Streaming**: The data flows like a garden hose. As soon as a little bit of data arrives at the server, it is immediately sent to S3. The server only needs a tiny bit of RAM.

### Multer vs Multer-S3
- **Multer**: A tool for Node.js to handle file uploads.
- **Multer-S3**: An extension for Multer that adds the ability to send those files directly to cloud storage.

---

## 🔗 Related Files

- [upload.js](./README-upload-routes.md) - Uses this middleware in its routes
- [asyncUploadController.js](./README-async-controller.md) - Gets the `videoKey` results from this middleware
- [aws.js](./README-aws.md) - General AWS/S3 configuration
