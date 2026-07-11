# 🖼️ Cloudinary Integration - Quick Reference

## Backend Setup ✅
```bash
# Install packages
npm install cloudinary multer

# Configure .env
CLOUDINARY_CLOUD_NAME=dyc0vdpr0
CLOUDINARY_API_KEY=369494173638344
CLOUDINARY_API_SECRET=your_api_secret

# Files added
- src/services/cloudinary.ts
- src/middleware/upload.ts
- src/routes/upload.ts
```

## API Endpoints
```javascript
// Upload single image
POST /api/upload/image
Body: form-data with 'image' field
Response: { url, optimizedUrl, publicId, width, height }

// Upload multiple images
POST /api/upload/images
Body: form-data with 'images' field (max 5)
Response: { images: [...], count }

// Delete image
DELETE /api/upload/:publicId
Response: { message: "Image deleted successfully" }
```

## Frontend Usage

### Simple Upload
```typescript
import { uploadImage } from '@/lib/api.config';

const response = await uploadImage(file, token);
console.log(response.url); // Cloudinary URL
```

### Product with Image
```typescript
// 1. Upload image
const uploadRes = await uploadImage(imageFile, token);

// 2. Create product with URL
await apiCall(API_ENDPOINTS.PRODUCTS.CREATE, 'POST', {
  name: 'Product',
  price: 99.99,
  image_url: uploadRes.url, // Store this in DB
}, token);
```

### Multiple Images
```typescript
const response = await uploadMultipleImages(files, token);
// response.images = [{ url, publicId, ... }, ...]
```

### Delete Image
```typescript
await deleteImage(publicId, token);
```

## Database Integration

### Store in Products
```sql
-- Add to products table
UPDATE products 
SET image_url = 'https://res.cloudinary.com/...' 
WHERE id = 'product-id';

-- Retrieve
SELECT id, name, image_url FROM products;
```

### Retrieve and Display
```typescript
// In component
<img src={product.image_url} alt={product.name} />

// Or with transformations
<img 
  src={getImageUrl(product.image_url, 500, 500)} 
  alt={product.name} 
/>
```

## Image Optimization

### Auto Format & Quality
```javascript
// Automatically serves best format
https://res.cloudinary.com/dyc0vdpr0/image/upload/f_auto,q_auto/...
```

### Responsive Sizes
```javascript
// Mobile
getImageUrl(publicId, 400, 300, 'fill')

// Tablet
getImageUrl(publicId, 768, 512, 'fill')

// Desktop
getImageUrl(publicId, 1200, 800, 'fill')
```

### Transformations
```javascript
// Crop to square
{ crop: 'auto', width: 500, height: 500 }

// Thumbnail
{ crop: 'thumb', width: 200, height: 200, gravity: 'face' }

// Circle
{ crop: 'fill', width: 300, height: 300, radius: 'max' }
```

## Authentication
```typescript
// Required header
Authorization: Bearer <token>

// All upload endpoints need authentication
```

## Error Handling
```typescript
try {
  const response = await uploadImage(file, token);
  console.log('Success:', response.url);
} catch (error) {
  console.error('Upload failed:', error.message);
}
```

## Folder Organization
```
shdwmen/                    // Main folder
├── products/               // Product images
├── gallery/                // Multiple images
└── avatars/                // User avatars (future)
```

## File Limits
- **Max size:** 10MB
- **Formats:** JPEG, PNG, GIF, WebP
- **Max files:** 5 per request (multi-upload)

## Examples

### Create Product with Image
```typescript
async function createProduct(formData, imageFile) {
  const token = localStorage.getItem('token');
  
  // Upload image
  const { url } = await uploadImage(imageFile, token);
  
  // Create product
  const product = await apiCall(
    API_ENDPOINTS.PRODUCTS.CREATE,
    'POST',
    {
      name: formData.name,
      price: formData.price,
      category: formData.category,
      image_url: url // Store Cloudinary URL
    },
    token
  );
  
  return product;
}
```

### Delete Product (with image cleanup)
```typescript
async function deleteProduct(productId, imagePublicId) {
  const token = localStorage.getItem('token');
  
  // Delete image from Cloudinary
  if (imagePublicId) {
    await deleteImage(imagePublicId, token);
  }
  
  // Delete product from DB
  await apiCall(
    API_ENDPOINTS.PRODUCTS.DELETE(productId),
    'DELETE',
    undefined,
    token
  );
}
```

### Display Product Image
```typescript
export function ProductCard({ product }) {
  return (
    <div>
      <img 
        src={product.image_url} 
        alt={product.name}
        width={300}
        height={300}
      />
      <h3>{product.name}</h3>
      <p>${product.price}</p>
    </div>
  );
}
```

## Testing in Postman

1. **Get token** (login first)
2. **Create POST request to** `http://localhost:5000/api/upload/image`
3. **Add header:** `Authorization: Bearer <token>`
4. **Body → form-data:**
   - Key: `image`
   - Value: Select image file
5. **Send!**

## Useful Links
- 📖 [Cloudinary Docs](https://cloudinary.com/documentation)
- 🖼️ [Image Transformations](https://cloudinary.com/documentation/image_transformation_reference)
- 💾 [Neon PostgreSQL](https://neon.tech/docs/)

---

**Everything ready! Start uploading images! 🚀**
