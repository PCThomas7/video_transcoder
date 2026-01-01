# 📄 index.js - Application Entry Point

## 📍 Location
`src/index.js`

---

## 🎯 What Does This File Do?

This is the **starting point** of the application. When you run `node src/index.js`, this file:

1. Creates an Express web server
2. Connects to **MongoDB** (Database)
3. Connects to **Redis** (for Queues)
4. Configures middleware (CORS, JSON parsing)
5. Sets up API routes
6. Starts listening for incoming requests

---

## 📝 Code Breakdown

```javascript
import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';
import { redisConnection, initQueueEvents } from './config/queue.js';
import uploadRouter from './routes/upload.js';
```

### What's Happening Here?

| Import | Purpose |
|--------|---------|
| `express` | Web framework to create the server |
| `cors` | Allows requests from other domains (like your frontend) |
| `connectDB` | Function to establish connection with MongoDB |
| `redisConnection` | The connection object for our Redis server |
| `initQueueEvents` | Sets up listeners for background job events |
| `uploadRouter` | The routes for handling video uploads |

---

```javascript
const app = express();
app.set('trust proxy', true);
const port = process.env.PORT || 2000;
```

### What's Happening Here?

1. **`app = express()`** - Creates an Express application
2. **`app.set('trust proxy', true)`** - Tells Express to trust the proxy (like Nginx), important for getting correct IP addresses.
3. **`port = process.env.PORT || 2000`** - Uses port from environment variable, or defaults to 2000

---

```javascript
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
```

### Middleware Configuration

| Middleware | What It Does |
|------------|--------------|
| `cors()` | Allows cross-origin requests (frontend on different domain can call this API) |
| `express.json()` | Parses JSON data in request body so we can use `req.body` |
| `express.urlencoded()` | Parses URL-encoded data (like form submissions) |

---

```javascript
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Health Check Endpoint
This is used to check if the server is running. If it returns `200 OK`, everything is fine!

---

```javascript
app.use('/api/upload', uploadRouter);
```

### Route Mounting

This line says: "Use the `uploadRouter` for any request that starts with `/api/upload`"

---

## 🚀 The startServer Function

```javascript
const startServer = async () => {
    try {
        await connectDB(); // 1. Connect to Database
        await redisConnection.ping(); // 2. Check Redis connection
        await initQueueEvents(); // 3. Start job tracking
        app.listen(port, () => { ... }); // 4. Start the server
    } catch (error) {
        process.exit(1); // Stop if something goes wrong
    }
};
```

---

## 🔄 Visual Flow

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Request                         │
│              (e.g., POST /api/upload/v1/upload)         │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 1. Global Middlewares                   │
│          (CORS, JSON Parsing, etc.)                     │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                2. uploadRouter                          │
│    (Routes like /api/upload/v1/upload)                  │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                3. Controller Logic                      │
│    (Processes files, talks to S3/Redis)                 │
└─────────────────────────────────────────────────────────┘
```

---

## 🧠 Key Concepts

### What is Redis?
Redis is a super-fast "in-memory" database. We use it to manage our **Job Queue**. When a video is uploaded, we tell Redis "Hey, remember this video needs to be transcoded!"

### Why Async startServer?
We shouldn't start the web server until we are **sure** we have a connection to MongoDB and Redis. Otherwise, the app would crash when trying to handle a request.

---

## 🔗 Related Files

- [db.js](./README-db.md) - MongoDB connection details
- [queue.js](./README-queue-config.md) - Redis and Queue configuration
- [upload.js](./README-upload-routes.md) - Defines the upload routes
