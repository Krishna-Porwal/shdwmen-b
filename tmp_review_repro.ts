import 'dotenv/config';
import fs from 'fs';
import { query } from './src/db/connection';
import { detectReviewSchemaInfo, buildReviewInsertConfig, ReviewSchemaInfo } from './src/utils/reviewCompatibility';
import jwt from 'jsonwebtoken';

const userId = 'user_3GgHSTRX3ulqHfCXZTu5QrOj027';
const email = 'user_3GgHSTRX3ulqHfCXZTu5QrOj027@clerk.local';
const orderItemId = 'a9fb4770-da63-46b8-b694-463e809cf521';
const productId = 'f29145a8-5d2f-4257-9389-e6ff68ad416b';
const apiUrl = 'http://localhost:5000/api/reviews';

function buildReviewSql(info: ReviewSchemaInfo, productId: string, userId: string, rating: number, reviewText: string, title: string | null, reviewImages: string[], existingReviewId?: string) {
  const reviewImagesJson = Array.isArray(reviewImages) ? reviewImages.filter((img) => typeof img === 'string') : [];
  const hasReviewText = typeof reviewText === 'string' && reviewText.trim().length > 0;
  const hasReviewImages = reviewImagesJson.length > 0;

  if (existingReviewId) {
    const updateColumns: string[] = ['rating = $1'];
    const updateParams: any[] = [rating];
    let nextParam = 2;

    if (info.hasTitle) {
      updateColumns.push(`title = $${nextParam}`);
      updateParams.push(title || null);
      nextParam += 1;
    }

    if (info.hasReview) {
      updateColumns.push(`review = $${nextParam}`);
      updateParams.push(reviewText);
      nextParam += 1;
    } else if (info.hasComment) {
      updateColumns.push(`comment = $${nextParam}`);
      updateParams.push(reviewText);
      nextParam += 1;
    }

    if (info.hasReviewImages) {
      updateColumns.push(`review_images = $${nextParam}::jsonb`);
      updateParams.push(JSON.stringify(reviewImagesJson));
      nextParam += 1;
    }

    if (info.hasUpdatedAt) {
      updateColumns.push('updated_at = CURRENT_TIMESTAMP');
    }

    updateParams.push(existingReviewId);
    updateParams.push(userId);
    const sql = `UPDATE reviews SET ${updateColumns.join(', ')} WHERE id = $${nextParam} AND user_id = $${nextParam + 1}`;
    return { sql, params: updateParams };
  }

  const insertConfig = buildReviewInsertConfig(info, '00000000-0000-0000-0000-000000000000', productId, userId, rating, title, reviewText, reviewImagesJson);
  return { sql: insertConfig.text, params: insertConfig.params };
}

async function run() {
  const token = jwt.sign({ userId, email }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
  const reviewVariants = [
    {
      name: 'rating-only',
      body: {
        orderItemId,
        productId,
        rating: 5,
      },
    },
    {
      name: 'rating + review',
      body: {
        orderItemId,
        productId,
        rating: 4,
        review: 'This is a text-only review that should be accepted if images are not required.',
      },
    },
    {
      name: 'rating + review + image',
      body: {
        orderItemId,
        productId,
        rating: 5,
        review: 'Review text with image upload test.',
        review_images: ['https://res.cloudinary.com/demo/image/upload/v123456/test.jpg'],
      },
    },
  ];

  const info = await detectReviewSchemaInfo(async (sql: string) => await query(sql));
  console.log('Detected schema:', info);

  const existingReview = await query('SELECT id FROM reviews WHERE product_id = $1 AND user_id = $2 LIMIT 1', [productId, userId]);
  const existingId = existingReview.rows[0]?.id;
  console.log('Existing review id:', existingId || 'none');

  const results: any[] = [];

  for (const variant of reviewVariants) {
    const reviewText = String((variant.body as any).review || '').trim();
    const images = Array.isArray((variant.body as any).review_images) ? (variant.body as any).review_images : [];
    const title = null;
    const reviewSql = buildReviewSql(info, productId, userId, variant.body.rating, reviewText, title, images, existingId);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(variant.body),
    });
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    results.push({
      variant: variant.name,
      requestBody: variant.body,
      reviewSql,
      response: {
        status: response.status,
        body: data,
      },
    });
  }

  const output = {
    detectedSchema: info,
    existingReviewId: existingId || null,
    results,
  };
  fs.writeFileSync('tmp_review_repro_result.json', JSON.stringify(output, null, 2), 'utf8');
  console.error('Wrote debug file tmp_review_repro_result.json');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
