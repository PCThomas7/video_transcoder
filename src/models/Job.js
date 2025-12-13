import mongoose from 'mongoose';

const JobSchema = new mongoose.Schema({
    // Unique job identifier (used for queue reference)
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // Original video file info
    originalFileName: {
        type: String,
        required: true
    },
    originalFileSize: {
        type: Number
    },
    mimeType: {
        type: String
    },
    // S3 storage keys
    rawVideoKey: {
        type: String,
        required: true
    },
    hlsPrefix: {
        type: String
    },
    // Job status tracking
    status: {
        type: String,
        enum: ['pending', 'queued', 'processing', 'completed', 'failed'],
        default: 'pending',
        index: true
    },
    // Progress tracking (0-100)
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    // Per-resolution progress
    resolutions: {
        '360p': { status: { type: String, default: 'pending' }, progress: { type: Number, default: 0 } },
        '480p': { status: { type: String, default: 'pending' }, progress: { type: Number, default: 0 } },
        '720p': { status: { type: String, default: 'pending' }, progress: { type: Number, default: 0 } },
        '1080p': { status: { type: String, default: 'pending' }, progress: { type: Number, default: 0 } }
    },
    // Output URLs (populated after transcoding)
    videoUrl: String,
    hlsStreamUrl: String,
    hlsPlaylistUrl: String,
    // Error tracking
    error: {
        message: String,
        stack: String,
        occurredAt: Date
    },
    // Retry tracking
    attempts: {
        type: Number,
        default: 0
    },
    maxAttempts: {
        type: Number,
        default: 3
    },
    // Timestamps
    queuedAt: Date,
    startedAt: Date,
    completedAt: Date,
    failedAt: Date
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Compound index for querying active jobs
JobSchema.index({ status: 1, createdAt: -1 });

const Job = mongoose.model('Job', JobSchema);

export default Job;
