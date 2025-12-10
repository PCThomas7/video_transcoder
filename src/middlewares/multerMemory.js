import multer from 'multer'

const multerMemory = multer({
    storage: multer.memoryStorage(),
})

export default multerMemory;