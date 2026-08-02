const reviewSchemaInfo = {
  hasTitle: false,
  hasReview: false,
  hasComment: true,
  hasReviewImages: false,
  hasIsVerifiedPurchase: false,
  hasUpdatedAt: false,
};

const rating = 5;
const reviewText = 'Love it with photos';
const review_images = ['https://res.cloudinary.com/demo/image/upload/v123456/test.jpg'];
const reviewImagesJson = Array.isArray(review_images) ? review_images.filter((img) => typeof img === 'string') : [];
const reviewId = '1b53871b-a92a-47ac-b095-83ccd79d0c85';

const updateColumns = ['rating = $1'];
const updateParams = [rating];
let nextParam = 2;

if (reviewSchemaInfo.hasTitle) {
  updateColumns.push(`title = $${nextParam}`);
  updateParams.push(null);
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
console.log(sql);
console.log(JSON.stringify(updateParams, null, 2));
