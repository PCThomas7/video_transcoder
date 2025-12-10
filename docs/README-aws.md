# ☁️ aws.js - Cloud Storage Configuration

## 📍 Location
`src/config/aws.js`

---

## 🎯 What Does This File Do?

This file configures the connection to **Wasabi S3** (cloud storage), similar to Amazon S3. It:

1. Sets up AWS SDK credentials
2. Creates an S3 client for uploading/downloading files
3. Provides a function to generate secure, temporary URLs (pre-signed URLs)

---

## 📝 Code Breakdown

```javascript
import AWS from 'aws-sdk';
```

### What's Happening Here?
We import the official AWS SDK (Software Development Kit) for JavaScript. This library provides tools to interact with AWS services like S3.

---

```javascript
const s3Config = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    endpoint: process.env.WASABI_ENDPOINT || 's3.us-east-1.wasabisys.com',
    s3ForcePathStyle: true,
};
```

### Configuration Object Explained

| Property | What It Means | Example Value |
|----------|---------------|---------------|
| `accessKeyId` | Your account identifier (like a username) | `AKIAIOSFODNN7EXAMPLE` |
| `secretAccessKey` | Your secret password | `wJalrXUtnFEMI/K7MDENG/...` |
| `region` | Geographic location of your storage | `us-east-1` |
| `endpoint` | The server address for Wasabi | `s3.us-east-1.wasabisys.com` |
| `s3ForcePathStyle` | Use path-style URLs instead of subdomain-style | `true` |

> ⚠️ **Security Note**: Never hardcode credentials in your code! Always use environment variables.

---

```javascript
AWS.config.update(s3Config);
const s3 = new AWS.S3();
```

### What's Happening Here?

1. **`AWS.config.update()`** - Updates the AWS SDK with our configuration
2. **`new AWS.S3()`** - Creates an S3 client we can use to upload/download files

---

## 🔐 Pre-Signed URLs Explained

```javascript
export const getSignedUrl = (key, expiresIn = 86400) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
        Expires: expiresIn,
    };
    return s3.getSignedUrl('getObject', params);
};
```

### What is a Pre-Signed URL?

A **pre-signed URL** is a temporary, secure URL that allows access to a private file.

**Without pre-signed URL:**
```
https://bucket.s3.wasabisys.com/myvideo.mp4
→ ❌ Access Denied (file is private)
```

**With pre-signed URL:**
```
https://bucket.s3.wasabisys.com/myvideo.mp4?X-Amz-Algorithm=...&X-Amz-Signature=...
→ ✅ Access Granted (for 24 hours)
```

### Parameters Explained

| Parameter | Purpose | Value |
|-----------|---------|-------|
| `Bucket` | Which storage bucket to use | From environment variable |
| `Key` | The file path/name in the bucket | e.g., `videos/myvideo.mp4` |
| `Expires` | How long the URL is valid (in seconds) | `86400` = 24 hours |

---

## 🖼️ Visual Representation

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR APPLICATION                          │
│                                                                  │
│    ┌─────────────────┐         ┌─────────────────────────┐      │
│    │   aws.js        │         │  Other Files            │      │
│    │                 │ exports │  (uploadController.js)  │      │
│    │  s3 client      │ ──────► │                         │      │
│    │  getSignedUrl   │         │  Uses s3 to upload      │      │
│    └─────────────────┘         │  Uses getSignedUrl      │      │
│                                └─────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   │ HTTPS Requests
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        WASABI S3 CLOUD                           │
│                                                                  │
│    ┌─────────────────────────────────────────────────────┐      │
│    │                    Your Bucket                       │      │
│    │                                                      │      │
│    │    📁 videos/                                        │      │
│    │        └── video1.mp4                                │      │
│    │        └── video2.mp4                                │      │
│    │    📁 hls/                                           │      │
│    │        └── 360p/                                     │      │
│    │            └── index.m3u8                            │      │
│    │            └── segment000.ts                         │      │
│    │                                                      │      │
│    └─────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧠 Key Concepts

### What is S3?
**S3** (Simple Storage Service) is a cloud storage service. Think of it like a giant hard drive on the internet where you can store files.

### What is a Bucket?
A **bucket** is like a top-level folder in S3. It's a container that holds your files.

### What is Wasabi?
**Wasabi** is an alternative to Amazon S3. It's cheaper and S3-compatible, meaning the same code works with both.

### Why Use Environment Variables?
```javascript
process.env.AWS_ACCESS_KEY_ID
```
- **Security**: Credentials aren't in the code (which might be shared on GitHub)
- **Flexibility**: Different values for development vs production
- **Ease**: Change configuration without modifying code

---

## 🔧 Environment Variables Needed

Create a `.env` file with:

```env
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-bucket-name
WASABI_ENDPOINT=s3.us-east-1.wasabisys.com
```

---

## 📤 Export Summary

| Export | Type | Purpose |
|--------|------|---------|
| `default` (s3) | Object | S3 client for upload/download operations |
| `getSignedUrl` | Function | Generate temporary secure URLs |

---

## 🔗 Related Files

This file is used by:
- [uploadController.js](./README-uploadController.md) - Uses s3 for uploads and getSignedUrl for secure URLs
