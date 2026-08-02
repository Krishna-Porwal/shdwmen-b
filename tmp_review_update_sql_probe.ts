import 'dotenv/config';
import { query } from './src/db/connection';
import { detectReviewSchemaInfo } from './src/utils/reviewCompatibility';

(async () => {
  try {
    const productId = 'f29145a8-5d2f-4257-9389-e6ff68ad416b';
    const userId = 'user_3GgHSTRX3ulqHfCXZTu5QrOj027';
    const orderItemId = 'a9fb4770-da63-46b8-b694-463e809cf521';

    const reviewSchemaInfo = await detectReviewSchemaInfo((sql) => query(sql));
    console.log('reviewSchemaInfo', reviewSchemaInfo);

    const existingReview = await query('SELECT * FROM reviews WHERE product_id = $1 AND user_id = $2', [productId, userId]);
    console.log('existingReview rows', existingReview.rows);
    if (existingReview.rows.length === 0) {
      console.log('No existing review, insert path not tested');
      process.exit(0);
    }
    const reviewId = existingReview.rows[0].id;

    const rating = 5;
    const title = 'Great product';
    const reviewText = 'Love it with photos';
    const review_images = ['https://res.cloudinary.com/demo/image/upload/v123456/test.jpg'];
    const reviewImagesJson = Array.isArray(review_images) ? review_images.filter((img) => typeof img === 'string') : [];
    const hasReviewText = reviewText.length > 0;
    const hasReviewImages = reviewImagesJson.length > 0;
    console.log('hasReviewText', hasReviewText, 'hasReviewImages', hasReviewImages);

    const updateColumns: string[] = ['rating = $1'];
    const updateParams: any[] = [rating];
    let nextParam = 2;

    if (reviewSchemaInfo.hasTitle) {
      updateColumns.push(`title = $${nextParam}`);
      updateParams.push(title || null);
      nextParam += 1;
    }

    if (reviewSchemaInfo.hasReview) {
      updateColumns.push(`review = $${nextParam}`);
      updateParams.push(reviewText);
      nextParam += 1;
    } else if (reviewSchemaInfo.hasComment) {
      updateColumns.push(`comment = $${nextParam}`);
      updateParams.push(reviewText);
      nextParam += 1;
    }

    if (reviewSchemaInfo.hasReviewImages) {
      updateColumns.push(`review_images = $${nextParam}`);
      updateParams.push(JSON.stringify(reviewImagesJson));
      nextParam += 1;
    }

    if (reviewSchemaInfo.hasUpdatedAt) {
      updateColumns.push('updated_at = CURRENT_TIMESTAMP');
    }

    updateParams.push(reviewId);
    const sql = `UPDATE reviews SET ${updateColumns.join(', ')} WHERE id = $${nextParam}`;
    console.log('sql', sql);
    console.log('params', JSON.stringify(updateParams, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
