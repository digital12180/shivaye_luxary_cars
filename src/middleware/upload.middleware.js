// import multer from "multer";

// const storage = multer.memoryStorage();

// const fileFilter = (req, file, cb) => {
//     if (
//         file.mimetype.startsWith("image/") ||
//         file.mimetype === "application/pdf"
//     ) {
//         cb(null, true);
//     } else {
//         cb(new Error("Only image and PDF files are allowed"), false);
//     }
// };

// export const upload = multer({
//     storage,
//     limits: {
//         fileSize: 5 * 1024 * 1024, // 5MB
//     },
//     fileFilter,
// });

// middlewares/upload.js
import multer from "multer";

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowed =
        file.mimetype.startsWith("image/") ||
        file.mimetype.startsWith("video/") ||
        file.mimetype === "application/pdf";

    if (allowed) cb(null, true);
    else cb(new Error("Only image, video, and PDF files are allowed"), false);
};

export const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (videos are bigger)
    fileFilter,
});