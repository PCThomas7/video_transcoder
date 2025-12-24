import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';
import { redisConnection, initQueueEvents } from './config/queue.js';
import uploadRouter from './routes/upload.js';

const app = express();
app.set('trust proxy', true);
const port = process.env.PORT || 2000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/upload', uploadRouter);

// Initialize connections and start server
const startServer = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        // Verify Redis connection
        await redisConnection.ping();
        console.log('Redis ping successful');

        // Initialize queue event listeners for status tracking
        await initQueueEvents();

        // Start Express server
        app.listen(port, () => {
            console.log(`Server is running at http://localhost:${port}`);
            console.log(`API Endpoints:`);
            console.log(`  POST /api/upload/v1/upload - Async upload (recommended)`);
            console.log(`  GET  /api/upload/v1/jobs/:jobId/status - Check job status`);
            console.log(`  GET  /api/upload/v1/jobs - List all jobs`);
            console.log(`  POST /api/upload/upload-transcode - Legacy sync upload`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();