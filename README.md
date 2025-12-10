# Video Transcoder with S3 Integration

This project is a video transcoder that allows users to upload videos and converts them into various formats and resolutions. The uploaded videos are stored in AWS S3, enabling scalable and reliable storage.

## Features

- Upload videos directly to AWS S3.
- Transcode videos into multiple resolutions (360p, 480p, 720p, 1080p).
- Serve transcoded videos via HLS (HTTP Live Streaming).

## Project Structure

```
video-transcoder-s3
├── src
│   ├── index.js                # Entry point of the application
│   ├── routes
│   │   └── upload.js           # Routes for video uploads
│   ├── controllers
│   │   └── uploadController.js  # Handles video upload logic
│   ├── middlewares
│   │   ├── s3Uploader.js        # Middleware for uploading to S3
│   │   └── multerMemory.js      # Configures multer for memory storage
│   ├── services
│   │   └── s3Client.js         # Configured S3 client
│   ├── utils
│   │   └── ffmpeg.js           # Utility functions for video transcoding
│   └── config
│       └── aws.js              # AWS configuration settings
├── package.json                 # NPM configuration file
├── .env.example                 # Template for environment variables
└── README.md                    # Project documentation
```

## Setup Instructions

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd video-transcoder-s3
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure AWS Credentials**:
   - Create an AWS account and obtain your access key, secret key, and region.
   - Create a new file named `.env` in the root directory and add the following:
     ```
     AWS_ACCESS_KEY_ID=your_access_key
     AWS_SECRET_ACCESS_KEY=your_secret_key
     AWS_REGION=your_region
     S3_BUCKET_NAME=your_bucket_name
     ```

4. **Run the Application**:
   ```bash
   npm start
   ```

5. **Test Video Upload**:
   - Use a tool like Postman to send a POST request to `http://localhost:2000/api/upload` with a video file.

## Usage Guidelines

- Ensure that your AWS S3 bucket is properly configured to allow uploads.
- The application uses `ffmpeg` for transcoding videos. Make sure `ffmpeg` is installed on your system and accessible in your PATH.

## License

This project is licensed under the MIT License. See the LICENSE file for details.