import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ================= SINGLE FILE UPLOAD =================
export const uploadToCloudinary = (
  fileBuffer,
  resourceType = "auto",
  fileName = ""
) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          resource_type: resourceType, // image | raw | video | auto
          folder: "nosecret",
          public_id: fileName,
        },
        (error, result) => {
          if (error) return reject(error);

          resolve({
            url: result.secure_url,
            public_id: result.public_id,
          });
        }
      )
      .end(fileBuffer);
  });
};

// ================= MULTIPLE FILE UPLOAD =================
export const uploadMultipleToCloudinary = async (files = []) => {
  try {
    const uploadPromises = files.map((file) =>
      uploadToCloudinary(
        file.buffer,
        "auto",
        `${Date.now()}-${file.originalname}`
      )
    );

    const results = await Promise.all(uploadPromises);

    return results;
  } catch (error) {
    throw error;
  }
};

// ================= DELETE SINGLE FILE =================
export const deleteFromCloudinary = async (
  publicId,
  resourceType = "image"
) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });

    return result;
  } catch (error) {
    throw error;
  }
};

// ================= DELETE MULTIPLE FILES =================
export const deleteMultipleFromCloudinary = async (
  publicIds = [],
  resourceType = "image"
) => {
  try {
    const result = await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType,
    });

    return result;
  } catch (error) {
    throw error;
  }
};

export default cloudinary;