import express from 'express'
import cors from 'cors'
import uploadRouter from './routes/upload.js'

const app = express()
const port = process.env.PORT || 2000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use('/api/upload', uploadRouter)

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`)
})