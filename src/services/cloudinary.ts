import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import path from 'path';

dotenv.config();

const CLOUDINARY_PLACEHOLDERS = [
  'your_api_key',
  'your_api_secret',
  'change_me_add_your_api_secret',
  'your_cloud_name',
  'change_me',
];

const isPlaceholder = (value?: string) =>
  !value || CLOUDINARY_PLACEHOLDERS.some((placeholder) => value.includes(placeholder));

const validateCloudinaryConfig = () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || isPlaceholder(process.env.CLOUDINARY_CLOUD_NAME)) {
    throw new Error('Cloudinary cloud name is missing or invalid. Update CLOUDINARY_CLOUD_NAME in .env');
  }
  if (!process.env.CLOUDINARY_API_KEY || isPlaceholder(process.env.CLOUDINARY_API_KEY)) {
    throw new Error('Cloudinary API key is missing or invalid. Update CLOUDINARY_API_KEY in .env');
  }
  if (!process.env.CLOUDINARY_API_SECRET || isPlaceholder(process.env.CLOUDINARY_API_SECRET)) {
    throw new Error('Cloudinary API secret is missing or invalid. Update CLOUDINARY_API_SECRET in .env');
  }
};

// Validate and configure Cloudinary
validateCloudinaryConfig();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface UploadOptions {
  folder?: string;
  resource_type?: string;
  public_id?: string;
}

/**
 * Upload file to Cloudinary
 * @param fileStream - File buffer or stream
 * @param fileName - Name of the file
 * @param options - Additional upload options
 * @returns Upload result with URL
 */
export const uploadToCloudinary = async (
  fileStream: Buffer | NodeJS.ReadableStream,
  fileName: string,
  options: UploadOptions = {}
) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      resource_type: options.resource_type || 'image',
      folder: options.folder || 'shdwmen',
      // sanitize public id to avoid spaces and special chars which can break signing
      public_id: (() => {
        const raw = options.public_id || `${Date.now()}_${fileName}`;
        return raw
          .replace(/\s+/g, '_') // spaces -> underscore
          .replace(/[^a-zA-Z0-9_\-\.\/]/g, '') // allow alnum, _, -, ., /
          .slice(0, 200);
      })(),
    } as any;

    if (Buffer.isBuffer(fileStream)) {
      const extension = path.extname(fileName).replace('.', '') || 'jpeg';
      const dataUri = `data:image/${extension};base64,${fileStream.toString('base64')}`;

      cloudinary.uploader.upload(dataUri, uploadOptions)
        .then(resolve)
        .catch(reject);
      return;
    }

    if (typeof (fileStream as any).pipe === 'function') {
      const stream = cloudinary.uploader.upload_stream(uploadOptions as any, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
      (fileStream as any).pipe(stream);
      return;
    }

    reject(new Error('Unsupported file stream type for Cloudinary upload'));
  });
};

/**
 * Upload from URL to Cloudinary
 * @param url - Image URL
 * @param folder - Folder name
 * @returns Upload result with URL
 */
export const uploadUrlToCloudinary = async (
  url: string,
  folder: string = 'shdwmen'
) => {
  try {
    const result = await cloudinary.uploader.upload(url, {
      folder,
      resource_type: 'auto',
    });
    return result;
  } catch (error) {
    throw new Error(`Failed to upload image: ${error}`);
  }
};

/**
 * Delete image from Cloudinary
 * @param publicId - Public ID of the image
 */
export const deleteFromCloudinary = async (publicId: string) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    throw new Error(`Failed to delete image: ${error}`);
  }
};

/**
 * Generate optimized image URL
 * @param publicId - Public ID of the image
 * @param options - Transformation options
 * @returns Optimized image URL
 */
export const getOptimizedImageUrl = (
  publicId: string,
  options: {
    width?: number;
    height?: number;
    crop?: string;
    quality?: string;
    fetchFormat?: string;
  } = {}
) => {
  return cloudinary.url(publicId, {
    width: options.width || 500,
    height: options.height || 500,
    crop: options.crop || 'fill',
    quality: options.quality || 'auto',
    fetch_format: options.fetchFormat || 'auto',
  });
};

/**
 * Get image URL with custom transformations
 * @param publicId - Public ID of the image
 * @param width - Image width
 * @param height - Image height
 * @param crop - Crop mode (fill, pad, crop, thumb, auto)
 * @returns Image URL
 */
export const getImageUrl = (
  publicId: string,
  width: number = 500,
  height: number = 500,
  crop: string = 'fill'
) => {
  return cloudinary.url(publicId, {
    width,
    height,
    crop,
    quality: 'auto',
    fetch_format: 'auto',
  });
};

export default cloudinary;
