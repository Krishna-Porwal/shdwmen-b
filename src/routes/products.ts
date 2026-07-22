import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { requireMerchant } from '../middleware/auth';
import { deleteFromCloudinary } from '../services/cloudinary';
import logger from '../logger';

const router: Router = express.Router();

interface ProductImage {
  url: string;
  publicId?: string;
  optimizedUrl?: string;
}

interface SizeStockItem {
  size: string;
  stock: number;
}

interface ProductRequest {
  name: string;
  description: string;
  price: number;
  mrp?: number;
  category_top: string;
  category: string;
  stock?: number;
  size_stock?: SizeStockItem[];
  estimated_delivery_days?: number;
  status?: 'active' | 'draft' | 'out_of_stock' | 'inactive';
  gender?: string;
  tags?: string[];
  is_sponsored?: boolean;
  image_url?: string;
  brand?: string;
  imgs?: string[];
  images?: Array<ProductImage | string>;
  removed_public_ids?: string[];
}

const normalizeImageUrls = (images?: unknown, imgs?: unknown, fallbackImageUrl?: unknown): string[] => {
  const urls: string[] = [];
  const addUrl = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim();
      if (!urls.includes(trimmed)) {
        urls.push(trimmed);
      }
      return;
    }

    if (value && typeof value === 'object') {
      const candidate = value as Partial<ProductImage>;
      const resolvedUrl = candidate.url || candidate.optimizedUrl;
      if (typeof resolvedUrl === 'string' && resolvedUrl.trim()) {
        const trimmed = resolvedUrl.trim();
        if (!urls.includes(trimmed)) {
          urls.push(trimmed);
        }
      }
    }
  };

  if (Array.isArray(images)) {
    images.forEach(addUrl);
  }

  if (Array.isArray(imgs)) {
    imgs.forEach(addUrl);
  }

  if (typeof fallbackImageUrl === 'string' && fallbackImageUrl.trim()) {
    addUrl(fallbackImageUrl);
  }

  return urls;
};

const buildImageObjects = (images?: unknown, imgs?: unknown, fallbackImageUrl?: unknown): ProductImage[] => {
  return normalizeImageUrls(images, imgs, fallbackImageUrl).map((url) => ({ url }));
};

// Get all products
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, category_top, search, sortBy, isSponsored, status } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params: any[] = [];

    if (category_top) {
      sql += ` AND category_top = $${params.length + 1}`;
      params.push(category_top);
    }

    if (category) {
      sql += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    if (status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(status);
    } else {
      sql += ` AND status != 'inactive'`;
    }

    if (search) {
      sql += ` AND (name ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1} OR tags::text ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    if (req.query.tag) {
      sql += ` AND tags::text ILIKE $${params.length + 1}`;
      params.push(`%${String(req.query.tag)}%`);
    }

    if (req.query.ids) {
      const ids = String(req.query.ids)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        sql += ` AND id = ANY($${params.length + 1}::uuid[])`;
        params.push(ids);
      }
    }

    if (isSponsored === 'true') {
      sql += ` AND is_sponsored = true`;
    } else if (isSponsored === 'false') {
      sql += ` AND is_sponsored = false`;
    }

    // Sorting
    if (sortBy === 'trending') {
      sql += ' ORDER BY sold_count DESC, avg_rating DESC, created_at DESC';
    } else if (sortBy === 'best-seller') {
      sql += ' ORDER BY sold_count DESC';
    } else if (sortBy === 'rating') {
      sql += ' ORDER BY avg_rating DESC, sold_count DESC';
    } else if (sortBy === 'price-low') {
      sql += ' ORDER BY price ASC';
    } else if (sortBy === 'price-high') {
      sql += ' ORDER BY price DESC';
    } else if (sortBy === 'newest') {
      sql += ' ORDER BY created_at DESC';
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get single product
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Try to validate if it's a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    let result;
    
    if (uuidRegex.test(id)) {
      // It's a UUID, query directly
      result = await query('SELECT * FROM products WHERE id = $1', [id]);
    } else {
      // It might be a numeric ID from old data, try to find by ID cast
      // First try direct match in case numeric IDs were used
      result = await query('SELECT * FROM products WHERE id::text = $1', [id]);
      
      // If not found, return 404
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Create product (merchant only)
router.post('/', requireMerchant, async (req: Request<{}, {}, ProductRequest>, res: Response) => {
  try {
    logger.info({ auth: req.auth, body: req.body }, '[PRODUCTS] POST / create called');
    const {
      name,
      description,
      price,
      mrp,
      category_top,
      category,
      size_stock,
      estimated_delivery_days,
      status,
      tags,
      is_sponsored,
      image_url,
      imgs,
      images,
    } = req.body;
    const merchantId = req.auth?.userId;

    if (!name || !price || !category_top || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const stockSum = Array.isArray(size_stock)
      ? size_stock.reduce((sum, item) => sum + Math.max(0, Number(item.stock) || 0), 0)
      : Number(req.body.stock) || 0;

    const resolvedStatus = status
      ? status
      : stockSum === 0
      ? 'out_of_stock'
      : 'active';

    const resolvedGender = category_top === 'Boys' ? 'Boys' : 'Men';
    const productId = uuidv4();
    const imgsArray = normalizeImageUrls(images, imgs, image_url);
    const imageObjects = buildImageObjects(images, imgs, image_url);
    const imageUrl = imgsArray[0] || null;

    const insertSql = `INSERT INTO products
       (id, merchant_id, name, description, category_top, category, gender, tags, mrp, price,
        estimated_delivery_days, status, is_sponsored, image_url, imgs, images, size_stock, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`;

    logger.info('[PRODUCTS] Insert SQL:', insertSql);
    logger.info('[PRODUCTS] Insert params:', [
      productId,
      merchantId,
      name,
      description,
      category_top,
      category,
      resolvedGender,
      tags || [],
      mrp || price,
      price,
      estimated_delivery_days || 0,
      resolvedStatus,
      !!is_sponsored,
      imageUrl,
      imgsArray,
      JSON.stringify(imageObjects),
      JSON.stringify(size_stock || []),
      stockSum,
    ]);

    await query(
      `INSERT INTO products
       (id, merchant_id, name, description, category_top, category, gender, tags, mrp, price,
        estimated_delivery_days, status, is_sponsored, image_url, imgs, images, size_stock, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        productId,
        merchantId,
        name,
        description,
        category_top,
        category,
        resolvedGender,
        tags || [],
        mrp || price,
        price,
        estimated_delivery_days || 0,
        resolvedStatus,
        !!is_sponsored,
        imageUrl,
        imgsArray,
        JSON.stringify(imageObjects),
        JSON.stringify(size_stock || []),
        stockSum,
      ]
    );

    const result = await query('SELECT * FROM products WHERE id = $1', [productId]);
    res.status(201).json({
      message: 'Product created',
      product: result.rows[0],
    });
  } catch (error) {
    logger.error('Create product error:', error);
    const err = error as any;
    const payload: any = { error: 'Failed to create product' };
    if (process.env.NODE_ENV !== 'production') {
      payload.details = err?.message;
      payload.stack = err?.stack;
    }
    return res.status(500).json(payload);
  }
});

// Update product (merchant only)
router.put('/:id', requireMerchant, async (req: Request<{ id: string }, {}, Partial<ProductRequest>>, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      mrp,
      category_top,
      category,
      size_stock,
      estimated_delivery_days,
      status,
      tags,
      is_sponsored,
      image_url,
      imgs,
      images,
      removed_public_ids,
    } = req.body;
    const merchantId = req.auth?.userId;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let productId = id;
    if (!uuidRegex.test(id)) {
      const findResult = await query('SELECT id FROM products WHERE id::text = $1', [id]);
      if (findResult.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      productId = findResult.rows[0].id;
    }

    // Check if product belongs to merchant
    const product = await query('SELECT * FROM products WHERE id = $1 AND merchant_id = $2', [productId, merchantId]);
    if (product.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      params.push(description);
      paramCount++;
    }
    if (price !== undefined) {
      updates.push(`price = $${paramCount}`);
      params.push(price);
      paramCount++;
    }
    if (mrp !== undefined) {
      updates.push(`mrp = $${paramCount}`);
      params.push(mrp);
      paramCount++;
    }
    if (category_top !== undefined) {
      updates.push(`category_top = $${paramCount}`);
      params.push(category_top);
      paramCount++;
    }
    if (category !== undefined) {
      updates.push(`category = $${paramCount}`);
      params.push(category);
      paramCount++;
    }
    if (size_stock !== undefined) {
      updates.push(`size_stock = $${paramCount}`);
      params.push(JSON.stringify(size_stock));
      paramCount++;
      const totalStock = Array.isArray(size_stock)
        ? size_stock.reduce((sum, item) => sum + Math.max(0, Number(item.stock) || 0), 0)
        : 0;
      updates.push(`stock = $${paramCount}`);
      params.push(totalStock);
      paramCount++;
      if (status === undefined) {
        const autoStatus = totalStock === 0 ? 'out_of_stock' : 'active';
        updates.push(`status = $${paramCount}`);
        params.push(autoStatus);
        paramCount++;
      }
    }
    if (estimated_delivery_days !== undefined) {
      updates.push(`estimated_delivery_days = $${paramCount}`);
      params.push(estimated_delivery_days);
      paramCount++;
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }
    if (tags !== undefined) {
      updates.push(`tags = $${paramCount}`);
      params.push(tags);
      paramCount++;
    }
    if (is_sponsored !== undefined) {
      updates.push(`is_sponsored = $${paramCount}`);
      params.push(is_sponsored);
      paramCount++;
    }
    if (image_url !== undefined) {
      updates.push(`image_url = $${paramCount}`);
      params.push(image_url);
      paramCount++;
    }
    if (images !== undefined || imgs !== undefined || image_url !== undefined) {
      const normalizedImageUrls = normalizeImageUrls(images, imgs, image_url);
      const normalizedImageObjects = buildImageObjects(images, imgs, image_url);
      updates.push(`images = $${paramCount}`);
      params.push(JSON.stringify(normalizedImageObjects));
      paramCount++;
      updates.push(`imgs = $${paramCount}`);
      params.push(normalizedImageUrls);
      paramCount++;
      if (!image_url) {
        updates.push(`image_url = $${paramCount}`);
        params.push(normalizedImageUrls[0] || null);
        paramCount++;
      }
    }

    if (removed_public_ids && removed_public_ids.length > 0) {
      const deletePromises = removed_public_ids.map((publicId: string) => deleteFromCloudinary(publicId));
      await Promise.all(deletePromises);
      const currentImagesResult = await query('SELECT images FROM products WHERE id = $1', [productId]);
      const currentImages = currentImagesResult.rows[0]?.images || [];
      const filteredImages = currentImages.filter((img: ProductImage) => !removed_public_ids.includes(img.publicId || ''));
      updates.push(`images = $${paramCount}`);
      params.push(JSON.stringify(filteredImages));
      paramCount++;
      const filteredUrls = filteredImages.map((img: ProductImage) => img.url);
      updates.push(`imgs = $${paramCount}`);
      params.push(filteredUrls);
      paramCount++;
      updates.push(`image_url = $${paramCount}`);
      params.push(filteredUrls[0] || null);
      paramCount++;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(productId);

    await query(`UPDATE products SET ${updates.join(', ')} WHERE id = $${paramCount}`, params);

    const result = await query('SELECT * FROM products WHERE id = $1', [productId]);
    res.json({
      message: 'Product updated',
      product: result.rows[0],
    });
  } catch (error) {
    logger.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product (merchant only) - soft delete
router.delete('/:id', requireMerchant, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const merchantId = req.auth?.userId;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let productId = id;
    if (!uuidRegex.test(id)) {
      const findResult = await query('SELECT id FROM products WHERE id::text = $1', [id]);
      if (findResult.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      productId = findResult.rows[0].id;
    }

    const product = await query('SELECT * FROM products WHERE id = $1 AND merchant_id = $2', [productId, merchantId]);
    if (product.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query('UPDATE products SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['inactive', productId]);
    res.json({ message: 'Product set to inactive' });
  } catch (error) {
    logger.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Update product status (merchant only)
router.patch('/:id/status', requireMerchant, async (req: Request<{ id: string }, {}, { status: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const merchantId = req.auth?.userId;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let productId = id;
    if (!uuidRegex.test(id)) {
      const findResult = await query('SELECT id FROM products WHERE id::text = $1', [id]);
      if (findResult.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      productId = findResult.rows[0].id;
    }

    const product = await query('SELECT * FROM products WHERE id = $1 AND merchant_id = $2', [productId, merchantId]);
    if (product.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const allowedStatuses = ['active', 'draft', 'out_of_stock', 'inactive'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    await query('UPDATE products SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, productId]);
    res.json({ message: 'Product status updated', status });
  } catch (error) {
    logger.error('Update product status error:', error);
    res.status(500).json({ error: 'Failed to update product status' });
  }
});

export default router;
