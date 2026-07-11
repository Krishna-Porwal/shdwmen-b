import express, { Router, Request, Response } from 'express';
import { uploadSingle, uploadMultiple, handleMulterError } from '../middleware/upload';
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  getOptimizedImageUrl,
} from '../services/cloudinary';
import { requireAuth } from '../middleware/auth';

const router: Router = express.Router();

/**
 * Upload single image
 * POST /api/upload/image
 * Required: image file in form-data
 */
router.post('/image', requireAuth, uploadSingle, handleMulterError, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Upload to Cloudinary
    const result: any = await uploadToCloudinary(
      req.file.buffer,
      req.file.originalname,
      {
        folder: 'shdwmen/products',
        resource_type: 'image',
      }
    );

    // Generate optimized URL
    const optimizedUrl = getOptimizedImageUrl(result.public_id);

    res.status(201).json({
      message: 'Image uploaded successfully',
      url: result.secure_url,
      optimizedUrl,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

/**
 * Upload multiple images
 * POST /api/upload/images
 * Required: multiple image files in form-data
 */
router.post('/images', requireAuth, uploadMultiple, handleMulterError, async (req: Request, res: Response) => {
  try {
    console.log('[UPLOAD] POST /images called. req.auth:', (req as any).auth);
    console.log('[UPLOAD] env check:', {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME ? 'SET' : 'MISSING',
      apiKey: process.env.CLOUDINARY_API_KEY ? 'SET' : 'MISSING',
      apiSecret: process.env.CLOUDINARY_API_SECRET ? 'SET' : 'MISSING',
    });
    if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    const files = req.files as Express.Multer.File[];
    console.log('[UPLOAD] file count:', files.length, 'first file meta:', {
      originalname: files[0].originalname,
      mimetype: files[0].mimetype,
      size: files[0].size,
      hasBuffer: Buffer.isBuffer(files[0].buffer),
    });

    const uploadPromises = files.map((file) =>
      uploadToCloudinary(file.buffer, file.originalname, {
        folder: 'shdwmen/gallery',
      })
    );

    const results = await Promise.all(uploadPromises);

    const uploadedImages = results.map((result: any) => ({
      url: result.secure_url,
      optimizedUrl: getOptimizedImageUrl(result.public_id),
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    }));

    console.log('[UPLOAD] uploadedImages:', uploadedImages);
    res.status(201).json({
      message: 'Images uploaded successfully',
      images: uploadedImages,
      count: uploadedImages.length,
    });
  } catch (error) {
    console.error('Upload error:', error);
    const err = error as any;
    const payload: any = { error: 'Failed to upload images' };
    if (process.env.NODE_ENV !== 'production') {
      payload.details = err?.message;
      payload.stack = err?.stack;
    }
    return res.status(500).json(payload);
  }
});

/**
 * Delete image from Cloudinary
 * DELETE /api/upload/:publicId
 */
router.delete('/:publicId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({ error: 'Public ID required' });
    }

    await deleteFromCloudinary(publicId);

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

export default router;
