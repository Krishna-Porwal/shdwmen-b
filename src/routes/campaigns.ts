import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { requireMerchant } from '../middleware/auth';
import logger from '../logger';

const router: Router = express.Router();

interface CampaignRequest {
  name?: string;
  title?: string;
  headline?: string;
  offer_text?: string;
  subtitle?: string;
  button_text?: string;
  button_link?: string;
  description?: string;
  category_top?: string;
  category?: string;
  gender?: string;
  discount_percent?: number;
  discount_type?: string;
  discount_value?: number;
  banner_image?: string;
  product_ids?: string[];
  selected_categories?: string[];
  product_selection_mode?: string;
  status?: string;
  active?: boolean;
  start_date?: string;
  end_date?: string;
  created_by?: string;
}

const normalizeStatus = (status?: string) => {
  const value = (status || 'draft').toLowerCase();
  return ['draft', 'active', 'scheduled', 'expired', 'paused'].includes(value) ? value : 'draft';
};

const markExpiredCampaigns = async () => {
  await query(
    `UPDATE campaigns
     SET status = 'expired', active = false, updated_at = CURRENT_TIMESTAMP
     WHERE active = true
       AND status <> 'expired'
       AND end_date IS NOT NULL
       AND end_date < NOW()`
  );
};

const buildCampaignProductQuery = async (campaign: any) => {
  if (!campaign) return [];

  if (Array.isArray(campaign.product_ids) && campaign.product_ids.length > 0) {
    const result = await query(
      `SELECT id, name, price, mrp, image_url, imgs, images, category, brand, stock, avg_rating, review_count, estimated_delivery_days
       FROM products
       WHERE id = ANY($1::uuid[]) AND status <> 'inactive' ORDER BY created_at DESC`,
      [campaign.product_ids]
    );
    return result.rows;
  }

  const selectedCategories = Array.isArray(campaign.selected_categories) ? campaign.selected_categories.filter(Boolean) : [];
  if (campaign.product_selection_mode === 'category' && selectedCategories.length > 0) {
    const result = await query(
      `SELECT id, name, price, mrp, image_url, imgs, images, category, brand, stock, avg_rating, review_count, estimated_delivery_days
       FROM products
       WHERE merchant_id = $1 AND category = ANY($2::text[]) AND status <> 'inactive' ORDER BY created_at DESC`,
      [campaign.merchant_id, selectedCategories]
    );
    return result.rows;
  }

  return [];
};

const serializeCampaign = async (campaign: any) => {
  const products = await buildCampaignProductQuery(campaign);
  return {
    ...campaign,
    title: campaign.title || campaign.name || 'Limited Time Drop',
    headline: campaign.headline || campaign.name || 'Limited Time Drop',
    offer_text: campaign.offer_text || (campaign.discount_percent ? `UP TO ${campaign.discount_percent}% OFF` : 'UP TO 50% OFF'),
    subtitle: campaign.subtitle || campaign.description || 'Exclusive discounts on our most coveted pieces.',
    button_text: campaign.button_text || 'Grab The Deal',
    button_link: campaign.button_link || '/shop',
    status: normalizeStatus(campaign.status),
    discount_type: campaign.discount_type || 'percent',
    discount_value: campaign.discount_value ?? campaign.discount_percent ?? 0,
    selected_categories: Array.isArray(campaign.selected_categories) ? campaign.selected_categories : [],
    product_selection_mode: campaign.product_selection_mode || (campaign.product_ids?.length ? 'manual' : 'category'),
    active: campaign.active !== false && normalizeStatus(campaign.status) === 'active',
    products,
  };
};

router.get('/', async (req: Request, res: Response) => {
  try {
    await markExpiredCampaigns();

    const { category_top, category, gender, active } = req.query;
    let sql = 'SELECT * FROM campaigns WHERE 1=1';
    const params: any[] = [];

    if (category_top) {
      sql += ` AND category_top = $${params.length + 1}`;
      params.push(category_top);
    }

    if (category) {
      sql += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    if (gender) {
      sql += ` AND gender = $${params.length + 1}`;
      params.push(gender);
    }

    if (active === 'true') {
      sql += ` AND active = true AND status = 'active' AND (start_date IS NULL OR start_date <= NOW()) AND (end_date IS NULL OR end_date > NOW())`;
    } else if (active === 'false') {
      sql += ` AND active = false`;
    }

    sql += ' ORDER BY active DESC, start_date DESC NULLS LAST, created_at DESC';
    const result = await query(sql, params);
    const campaigns = await Promise.all(result.rows.map((row) => serializeCampaign(row)));
    res.json(campaigns);
  } catch (error) {
    logger.error('Get campaigns error:', error);
    res.status(500).json({ error: 'Failed to load campaigns' });
  }
});

router.get('/merchant', requireMerchant, async (req: Request, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    await markExpiredCampaigns();
    const result = await query(
      `SELECT * FROM campaigns WHERE merchant_id = $1 ORDER BY active DESC, start_date DESC NULLS LAST, created_at DESC`,
      [merchantId]
    );
    const campaigns = await Promise.all(result.rows.map((row) => serializeCampaign(row)));
    res.json(campaigns);
  } catch (error) {
    logger.error('Get merchant campaigns error:', error);
    res.status(500).json({ error: 'Failed to load merchant campaigns' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json(await serializeCampaign(result.rows[0]));
  } catch (error) {
    logger.error('Get campaign by id error:', error);
    res.status(500).json({ error: 'Failed to load campaign' });
  }
});

router.post('/', requireMerchant, async (req: Request<{}, {}, CampaignRequest>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const {
      name,
      title,
      headline,
      offer_text,
      subtitle,
      button_text,
      button_link,
      description,
      category_top,
      category,
      gender,
      discount_percent,
      discount_type,
      discount_value,
      banner_image,
      product_ids,
      selected_categories,
      product_selection_mode,
      status,
      active,
      start_date,
      end_date,
    } = req.body;

    if (!name && !title && !headline) {
      return res.status(400).json({ error: 'Campaign title is required' });
    }

    const normalizedStatus = normalizeStatus(status || (active ? 'active' : 'draft'));
    const campaignId = uuidv4();
    await query(
      `INSERT INTO campaigns (
        id, merchant_id, name, title, headline, offer_text, subtitle, button_text, button_link,
        description, category_top, category, gender, discount_percent, discount_type, discount_value,
        banner_image, product_ids, selected_categories, product_selection_mode, status, active,
        start_date, end_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        campaignId,
        merchantId,
        name || title || headline || 'Limited Time Drop',
        title || name || headline || 'Limited Time Drop',
        headline || title || name || 'Limited Time Drop',
        offer_text || null,
        subtitle || description || null,
        button_text || null,
        button_link || null,
        description || null,
        category_top || null,
        category || null,
        gender || null,
        discount_percent ?? 0,
        discount_type || 'percent',
        discount_value ?? discount_percent ?? 0,
        banner_image || null,
        Array.isArray(product_ids) ? product_ids : [],
        Array.isArray(selected_categories) ? selected_categories : [],
        product_selection_mode || (Array.isArray(product_ids) && product_ids.length > 0 ? 'manual' : 'category'),
        normalizedStatus,
        normalizedStatus === 'active',
        start_date ? new Date(start_date) : null,
        end_date ? new Date(end_date) : null,
        merchantId,
      ]
    );

    const result = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    res.status(201).json(await serializeCampaign(result.rows[0]));
  } catch (error) {
    logger.error('Create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

router.put('/:id', requireMerchant, async (req: Request<{ id: string }, {}, CampaignRequest>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { id } = req.params;
    const {
      name,
      title,
      headline,
      offer_text,
      subtitle,
      button_text,
      button_link,
      description,
      category_top,
      category,
      gender,
      discount_percent,
      discount_type,
      discount_value,
      banner_image,
      product_ids,
      selected_categories,
      product_selection_mode,
      status,
      active,
      start_date,
      end_date,
    } = req.body;

    const existing = await query('SELECT id FROM campaigns WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const pushValue = (column: string, value: any) => {
      updates.push(`${column} = $${idx}`);
      params.push(value);
      idx++;
    };

    if (name !== undefined) pushValue('name', name || null);
    if (title !== undefined) pushValue('title', title || null);
    if (headline !== undefined) pushValue('headline', headline || null);
    if (offer_text !== undefined) pushValue('offer_text', offer_text || null);
    if (subtitle !== undefined) pushValue('subtitle', subtitle || null);
    if (button_text !== undefined) pushValue('button_text', button_text || null);
    if (button_link !== undefined) pushValue('button_link', button_link || null);
    if (description !== undefined) pushValue('description', description || null);
    if (category_top !== undefined) pushValue('category_top', category_top || null);
    if (category !== undefined) pushValue('category', category || null);
    if (gender !== undefined) pushValue('gender', gender || null);
    if (discount_percent !== undefined) pushValue('discount_percent', discount_percent ?? 0);
    if (discount_type !== undefined) pushValue('discount_type', discount_type || 'percent');
    if (discount_value !== undefined) pushValue('discount_value', discount_value ?? 0);
    if (banner_image !== undefined) pushValue('banner_image', banner_image || null);
    if (product_ids !== undefined) pushValue('product_ids', Array.isArray(product_ids) ? product_ids : []);
    if (selected_categories !== undefined) pushValue('selected_categories', Array.isArray(selected_categories) ? selected_categories : []);
    if (product_selection_mode !== undefined) pushValue('product_selection_mode', product_selection_mode || 'category');
    if (status !== undefined) {
      const normalized = normalizeStatus(status);
      pushValue('status', normalized);
      pushValue('active', normalized === 'active');
    } else if (active !== undefined) {
      pushValue('active', active);
      if (active) {
        pushValue('status', 'active');
      }
    }
    if (start_date !== undefined) pushValue('start_date', start_date ? new Date(start_date) : null);
    if (end_date !== undefined) pushValue('end_date', end_date ? new Date(end_date) : null);

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE campaigns SET ${updates.join(', ')} WHERE id = $${idx} AND merchant_id = $${idx + 1}`;
    await query(sql, [...params, id, merchantId]);
    const result = await query('SELECT * FROM campaigns WHERE id = $1', [id]);
    res.json(await serializeCampaign(result.rows[0]));
  } catch (error) {
    logger.error('Update campaign error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

router.patch('/:id/status', requireMerchant, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { id } = req.params;
    const { status } = req.body as { status?: string };
    const normalizedStatus = normalizeStatus(status);
    if (!normalizedStatus) {
      return res.status(400).json({ error: 'Valid status is required' });
    }

    await query(
      `UPDATE campaigns SET status = $1, active = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND merchant_id = $4`,
      [normalizedStatus, normalizedStatus === 'active', id, merchantId]
    );

    const result = await query('SELECT * FROM campaigns WHERE id = $1', [id]);
    res.json(await serializeCampaign(result.rows[0]));
  } catch (error) {
    logger.error('Update campaign status error:', error);
    res.status(500).json({ error: 'Failed to update campaign status' });
  }
});

router.post('/:id/duplicate', requireMerchant, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { id } = req.params;
    const existing = await query('SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const source = existing.rows[0];
    const duplicateId = uuidv4();
    await query(
      `INSERT INTO campaigns (
        id, merchant_id, name, title, headline, offer_text, subtitle, button_text, button_link,
        description, category_top, category, gender, discount_percent, discount_type, discount_value,
        banner_image, product_ids, selected_categories, product_selection_mode, status, active,
        start_date, end_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        duplicateId,
        merchantId,
        `${source.name || source.title || 'Campaign'} Copy`,
        source.title || source.name || 'Limited Time Drop',
        source.headline || source.title || source.name || 'Limited Time Drop',
        source.offer_text,
        source.subtitle || source.description,
        source.button_text,
        source.button_link,
        source.description,
        source.category_top,
        source.category,
        source.gender,
        source.discount_percent || 0,
        source.discount_type || 'percent',
        source.discount_value ?? source.discount_percent ?? 0,
        source.banner_image,
        Array.isArray(source.product_ids) ? source.product_ids : [],
        Array.isArray(source.selected_categories) ? source.selected_categories : [],
        source.product_selection_mode || 'category',
        'draft',
        false,
        source.start_date,
        source.end_date,
        merchantId,
      ]
    );

    const result = await query('SELECT * FROM campaigns WHERE id = $1', [duplicateId]);
    res.status(201).json(await serializeCampaign(result.rows[0]));
  } catch (error) {
    logger.error('Duplicate campaign error:', error);
    res.status(500).json({ error: 'Failed to duplicate campaign' });
  }
});

router.delete('/:id', requireMerchant, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const merchantId = req.auth?.userId;
    const { id } = req.params;
    const existing = await query('SELECT id FROM campaigns WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    await query('UPDATE campaigns SET status = $1, active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND merchant_id = $3', ['expired', id, merchantId]);
    res.json({ message: 'Campaign removed' });
  } catch (error) {
    logger.error('Delete campaign error:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

export default router;
