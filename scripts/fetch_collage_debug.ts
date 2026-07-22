import { query } from '../src/db/connection';
import { getImageUrl } from '../src/services/cloudinary';

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
      if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
      try { return getImageUrl(trimmed); } catch { return trimmed; }
    }
    if (typeof item === 'object' && item !== null) {
      const candidate = item as { url?: string; optimizedUrl?: string };
      if (typeof candidate.optimizedUrl === 'string' && candidate.optimizedUrl.trim()) {
        const v = candidate.optimizedUrl.trim();
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

const buildCollection = async (title: string, extraCondition: string | null) => {
  const whereClause = extraCondition ? `WHERE status != 'inactive' AND ${extraCondition}` : `WHERE status != 'inactive'`;
  const productsResult = await query(
    `SELECT image_url, images, imgs
     FROM products
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 12`
  );
  const countResult = await query(
    `SELECT COUNT(*) as count
     FROM products
     ${whereClause}`
  );

  const imgs = productsResult.rows
    .map((row: any) => extractImageUrl(row))
    .filter((url: string | null): url is string => Boolean(url));

  return {
    title,
    productCount: Number(countResult.rows[0]?.count || 0),
    collageImages: Array.from(new Set(imgs)).slice(0, 4),
  };
};

(async () => {
  try {
    const collections = await Promise.all([
      buildCollection(
        'MENS FORMAL',
        `category_top = 'Men' AND (tags::text ILIKE '%formal%' OR category ILIKE '%shirt%' OR category ILIKE '%blazer%' OR category ILIKE '%suit%' OR category ILIKE '%trouser%')`
      ),
      buildCollection(
        'MENS CASUAL',
        `category_top = 'Men' AND (tags::text ILIKE '%casual%' OR category ILIKE '%t-shirt%' OR category ILIKE '%jean%' OR category ILIKE '%cargo%' OR category ILIKE '%hoodie%' OR category ILIKE '%sweatshirt%')`
      ),
      buildCollection('NEW IN', null),
    ]);
    console.log(JSON.stringify(collections, null, 2));
  } catch (err) {
    console.error('Debug fetch failed:', err);
    process.exit(1);
  }
})();
