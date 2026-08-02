import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { getImageUrl } from '../services/cloudinary';
import { requireMerchant } from '../middleware/auth';
import logger from '../logger';

const router: Router = express.Router();

interface CategoryRequest {
  name: string;
  top_category?: string;
  gender?: string;
  is_active?: boolean;
}

const extractImageUrl = (row: any): string | null => {
  if (typeof row.image_url === 'string' && row.image_url.trim()) {
    return row.image_url.trim();
  }

  const parseImages = (value: unknown) => {
    if (!value) return [] as any[];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return [] as any[];
  };

  const images = parseImages(row.images || row.imgs);
  for (const item of images) {
    if (!item) continue;
    if (typeof item === 'string' && item.trim()) {
      const trimmed = item.trim();
      // If it's already an absolute URL or a path, return as-is
      if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
      // Otherwise assume it's a Cloudinary public id and convert
      try {
        return getImageUrl(trimmed);
      } catch {
        return trimmed;
      }
    }
    if (typeof item === 'object' && item !== null) {
      const candidate = item as { url?: string; optimizedUrl?: string; secure_url?: string };
      if (typeof candidate.optimizedUrl === 'string' && candidate.optimizedUrl.trim()) {
        const v = candidate.optimizedUrl.trim();
        if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
        try { return getImageUrl(v); } catch { return v; }
      }
      if (typeof candidate.secure_url === 'string' && candidate.secure_url.trim()) {
        const v = candidate.secure_url.trim();
        if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
        try { return getImageUrl(v); } catch { return v; }
      }
      if (typeof candidate.url === 'string' && candidate.url.trim()) {
        const v = candidate.url.trim();
        if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
        try { return getImageUrl(v); } catch { return v; }
      }
    }
  }

  return null;
};

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache for category collages
let cachedCategoryCollages: any[] | null = null;
let cachedCategoryCollagesAt = 0;

const buildCollection = async (title: string, extraCondition: string | null, usedImages?: Set<string>) => {
  const whereClause = extraCondition ? `WHERE status != 'inactive' AND ${extraCondition}` : `WHERE status != 'inactive'`;

  const queryProductImages = async (condition: string, limit = 200) => {
    const result = await query(
      `SELECT image_url, images, imgs
       FROM products
       WHERE status != 'inactive' AND ${condition}
       ORDER BY created_at DESC
       LIMIT ${limit}`
    );
    return result.rows
      .map((row: any) => extractImageUrl(row))
      .filter((url: string | null): url is string => Boolean(url));
  };

  const countResult = await query(
    `SELECT COUNT(*) as count
     FROM products
     ${whereClause}`
  );

  const imgs = await queryProductImages(extraCondition ?? 'TRUE');
  const uniqueImgs = Array.from(new Set(imgs));
  const filtered: string[] = [];

  const addUniqueImages = (urls: string[]) => {
    for (const url of urls) {
      if (filtered.length >= 4) break;
      if (!filtered.includes(url) && !(usedImages && usedImages.has(url))) {
        filtered.push(url);
      }
    }
  };

  addUniqueImages(uniqueImgs);

  if (filtered.length < 4 && extraCondition) {
    const topCategoryFallback = extraCondition.includes("category_top ILIKE '%men%'")
      ? "category_top ILIKE '%men%'"
      : extraCondition.includes("category_top ILIKE '%boys%'")
      ? "category_top ILIKE '%boys%'"
      : null;

    if (topCategoryFallback) {
      const fallbackImgs = await queryProductImages(topCategoryFallback);
      addUniqueImages(Array.from(new Set(fallbackImgs)));
    }
  }

  if (filtered.length < 4) {
    const allImgs = await queryProductImages('TRUE', 400);
    addUniqueImages(Array.from(new Set(allImgs)));
  }

  // If still no images, retry without usedImages constraint for this specific collection
  if (filtered.length === 0) {
    const allImgs = await queryProductImages('TRUE', 400);
    const fallbackImages = Array.from(new Set(allImgs));
    for (const url of fallbackImages) {
      if (filtered.length >= 4) break;
      if (!filtered.includes(url)) {
        filtered.push(url);
      }
    }
  }

  const finalImages = Array.from(new Set(filtered)).slice(0, 4);

  if (usedImages) finalImages.forEach((u) => usedImages.add(u));

  return {
    title,
    productCount: Number(countResult.rows[0]?.count || 0),
    collageImages: finalImages,
  };
};

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, top_category, gender, is_active, merchant_id
       FROM categories
       WHERE is_active = true
       ORDER BY top_category NULLS LAST, name ASC`
    );

    if (result.rows.length > 0) {
      const topCategories: Record<string, string[]> = {};
      const categories: Array<{ id: string; name: string; top_category?: string; gender?: string }> = [];

      result.rows.forEach((row) => {
        const top = row.top_category || 'Men';
        if (!topCategories[top]) topCategories[top] = [];
        if (!topCategories[top].includes(row.name)) {
          topCategories[top].push(row.name);
        }
        categories.push({
          id: row.id,
          name: row.name,
          top_category: row.top_category,
          gender: row.gender,
        });
      });

      return res.json({ categories, topCategories });
    }

    const fallback = await query(
      `SELECT category_top, category
       FROM products
       WHERE status != 'inactive'
       GROUP BY category_top, category
       ORDER BY category_top NULLS LAST, category ASC`
    );

    const fallbackTopCategories: Record<string, string[]> = {};
    const fallbackCategories: Array<{ id: string; name: string; top_category?: string; gender?: string }> = [];

    fallback.rows.forEach((row, index) => {
      const top = row.category_top || 'Men';
      if (!fallbackTopCategories[top]) fallbackTopCategories[top] = [];
      fallbackTopCategories[top].push(row.category);
      fallbackCategories.push({
        id: `fallback-${index}`,
        name: row.category,
        top_category: row.category_top,
      });
    });

    res.json({ categories: fallbackCategories, topCategories: fallbackTopCategories });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

router.get('/collage', async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (cachedCategoryCollages && now - cachedCategoryCollagesAt < CACHE_TTL_MS) {
      return res.json(cachedCategoryCollages);
    }

    const usedImages = new Set<string>();
    const collections = [] as any[];

    collections.push(await buildCollection(
      'MENS FORMAL',
      `category_top ILIKE '%men%' AND (tags::text ILIKE '%formal%' OR subcategory ILIKE '%formal%' OR category ILIKE '%shirt%' OR category ILIKE '%blazer%' OR category ILIKE '%suit%' OR category ILIKE '%trouser%' OR attributes::text ILIKE '%formal%')`,
      usedImages
    ));

    collections.push(await buildCollection(
      'MENS CASUAL',
      `category_top ILIKE '%men%' AND (tags::text ILIKE '%casual%' OR subcategory ILIKE '%casual%' OR category ILIKE '%t-shirt%' OR category ILIKE '%jean%' OR category ILIKE '%cargo%' OR category ILIKE '%hoodie%' OR category ILIKE '%sweatshirt%' OR attributes::text ILIKE '%casual%')`,
      usedImages
    ));

    collections.push(await buildCollection('NEW IN', null, usedImages));
    collections.push(await buildCollection('BOYS', `category_top ILIKE '%boys%' OR gender ILIKE '%boy%' OR category ILIKE '%boys%'`, usedImages));

    cachedCategoryCollages = collections;
    cachedCategoryCollagesAt = now;

    res.json(collections);
  } catch (error) {
    logger.error('Get category collage error:', error);
    res.status(500).json({ error: 'Failed to load category collages' });
  }
});

router.get('/merchant', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const result = await query(
      `SELECT id, name, top_category, gender, is_active
       FROM categories
       WHERE merchant_id = $1
       ORDER BY top_category NULLS LAST, name ASC`,
      [merchantId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get merchant categories error:', error);
    res.status(500).json({ error: 'Failed to load merchant categories' });
  }
});

router.post('/', requireMerchant, async (req: Request<{}, {}, CategoryRequest>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { name, top_category, gender, is_active } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const categoryId = uuidv4();
    await query(
      `INSERT INTO categories (id, merchant_id, name, top_category, gender, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [categoryId, merchantId, name, top_category || null, gender || null, is_active !== false]
    );

    const result = await query('SELECT id, name, top_category, gender, is_active FROM categories WHERE id = $1', [categoryId]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

router.put('/:id', requireMerchant, async (req: Request<{ id: string }, {}, CategoryRequest>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { id } = req.params;
    const { name, top_category, gender, is_active } = req.body;

    const existing = await query('SELECT id FROM categories WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx}`);
      params.push(name);
      idx++;
    }
    if (top_category !== undefined) {
      updates.push(`top_category = $${idx}`);
      params.push(top_category);
      idx++;
    }
    if (gender !== undefined) {
      updates.push(`gender = $${idx}`);
      params.push(gender);
      idx++;
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx}`);
      params.push(is_active);
      idx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    await query(`UPDATE categories SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} AND merchant_id = $${idx + 1}`, [...params, id, merchantId]);
    const result = await query('SELECT id, name, top_category, gender, is_active FROM categories WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/:id', requireMerchant, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { id } = req.params;
    const existing = await query('SELECT id FROM categories WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await query('UPDATE categories SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    logger.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
