import multer from 'multer'
import AWS from 'aws-sdk'
const { S3 } = AWS;
import { v4 as uuid } from 'uuid'

const s3 = new S3()

const uploadToS3 = async (file) => {
    const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `${uuid()}-${file.originalname}`,
        Body: file.buffer,
        ContentType: file.mimetype,
    }

    return s3.upload(uploadParams).promise()
}

export const s3Uploader = (req, res, next) => {
    const upload = multer({ storage: multer.memoryStorage() }).single('video')

    upload(req, res, async (error) => {
        if (error) {
            return res.status(400).json({ error: error.message ?? 'File upload failed!' })
        }

        if (!req.file) {
            return res.status(400).send('No file uploaded!')
        }

        try {
            const data = await uploadToS3(req.file)
            req.file.location = data.Location
            req.file.hlsUrl = `${data.Location.replace(/\.[^/.]+$/, '')}/360p/index.m3u8`
            next()
        } catch (uploadError) {
            return res.status(500).json({ error: 'Failed to upload to S3', details: uploadError.message })
        }
    })
}