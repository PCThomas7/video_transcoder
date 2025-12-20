import mongoose from 'mongoose';

const LessonSchema = new mongoose.Schema({
    lessonId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    title: {
        type: String,
        default: 'Untitled Lesson'
    },
    videoUrl: {
        type: String // Raw MP4 URL
    },
    hlsUrl: {
        type: String // HLS Master Playlist URL
    },
    transcodingStatus: {
        type: String,
        enum: ['pending', 'processing_low', 'processing_high', 'completed', 'failed'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const Lesson = mongoose.model('Lesson', LessonSchema);

export default Lesson;
