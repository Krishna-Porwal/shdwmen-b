# 🖼️ Cloudinary Image Upload Integration Guide

## ✅ Setup Complete

Your backend now has full Cloudinary image upload capabilities integrated with Neon PostgreSQL!

---

## 📦 What's Been Added

### Installed Packages
- ✅ `cloudinary` - Image upload and management
- ✅ `multer` - File upload middleware
- ✅ TypeScript types for multer

### New Files Created
- `src/services/cloudinary.ts` - Cloudinary configuration and utilities
- `src/middleware/upload.ts` - Multer middleware setup
- `src/routes/upload.ts` - Upload API endpoints
- `UPLOAD_EXAMPLES.tsx` - Frontend implementation examples
- `api.config.ts` - Updated with upload endpoints

### Environment Variables
Added to `.env`:
```env
CLOUDINARY_CLOUD_NAME=dyc0vdpr0
CLOUDINARY_API_KEY=369494173638344
CLOUDINARY_API_SECRET=change_me_add_your_api_secret
```

---

## 🚀 API Endpoints

### Upload Endpoints

#### 1. Upload Single Image
```
POST /api/upload/image
Headers: Authorization: Bearer <token>
Body: multipart/form-data with 'image' field

Response:
{
  "message": "Image uploaded successfully",
  "url": "https://res.cloudinary.com/...",
  "optimizedUrl": "https://res.cloudinary.com/...?w=500&h=500&...",
  "publicId": "shdwmen/products/...",
  "width": 1920,
  "height": 1080
}
```

#### 2. Upload Multiple Images
```
POST /api/upload/images
Headers: Authorization: Bearer <token>
Body: multipart/form-data with 'images' field (max 5 files)

Response:
{
  "message": "Images uploaded successfully",
  "images": [
    {
      "url": "https://res.cloudinary.com/...",
      "optimizedUrl": "...",
      "publicId": "...",
      "width": 1920,
      "height": 1080
    }
  ],
  "count": 3
}
```

#### 3. Delete Image
```
DELETE /api/upload/:publicId
Headers: Authorization: Bearer <token>

Response:
{
  "message": "Image deleted successfully"
}
```

---

## 💻 Frontend Integration

### Step 1: Copy Upload Examples
```bash
cp UPLOAD_EXAMPLES.tsx shdwmen-nextjs/components/
```

### Step 2: Use in Components

#### Simple Single Image Upload
```typescript
import { uploadImage } from '@/lib/api.config';
import { useState } from 'react';

export function ImageUpload() {
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login first');
      return;
    }

    setLoading(true);
    try {
      const response = await uploadImage(file, token);
      setImageUrl(response.url);
      console.log('Uploaded:', response.url);
    } catch (error) {
      alert('Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input type="file" accept="image/*" onChange={handleUpload} disabled={loading} />
      {imageUrl && <img src={imageUrl} alt="Uploaded" width={200} />}
    </div>
  );
}
```

#### Product Creation with Image
```typescript
import { uploadImage, apiCall, API_ENDPOINTS } from '@/lib/api.config';

export function CreateProductWithImage() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) return;

    setLoading(true);
    try {
      // Upload image
      let imageUrl = '';
      if (imageFile) {
        const uploadResponse = await uploadImage(imageFile, token);
        imageUrl = uploadResponse.url;
      }

      // Create product with image URL
      const formData = new FormData(e.currentTarget);
      const productData = {
        name: formData.get('name'),
        description: formData.get('description'),
        price: parseFloat(formData.get('price') as string),
        category: formData.get('category'),
        stock: parseInt(formData.get('stock') as string),
        image_url: imageUrl,
      };

      await apiCall(API_ENDPOINTS.PRODUCTS.CREATE, 'POST', productData, token);
      alert('Product created!');
    } catch (error) {
      alert('Failed to create product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="text" name="name" placeholder="Product Name" required />
      <textarea name="description" placeholder="Description" />
      <input type="number" name="price" placeholder="Price" required />
      <input type="text" name="category" placeholder="Category" required />
      <input type="number" name="stock" placeholder="Stock" required />
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Product'}
      </button>
    </form>
  );
}
```

---

## 🔧 Backend Utilities

### Upload to Cloudinary
```typescript
import { uploadToCloudinary } from '@/services/cloudinary';

const result = await uploadToCloudinary(fileBuffer, 'filename.jpg', {
  folder: 'shdwmen/products',
  resource_type: 'image',
});
// Returns: { secure_url, public_id, width, height, ... }
```

### Upload from URL
```typescript
import { uploadUrlToCloudinary } from '@/services/cloudinary';

const result = await uploadUrlToCloudinary('https://example.com/image.jpg', 'shdwmen');
// Returns: { secure_url, public_id, ... }
```

### Generate Optimized URL
```typescript
import { getOptimizedImageUrl } from '@/services/cloudinary';

const url = getOptimizedImageUrl('shdwmen/products/abc123', {
  width: 500,
  height: 500,
  crop: 'fill',
  quality: 'auto',
  fetchFormat: 'auto',
});
// Returns: https://res.cloudinary.com/...?w=500&h=500&...
```

### Delete Image
```typescript
import { deleteFromCloudinary } from '@/services/cloudinary';

await deleteFromCloudinary('shdwmen/products/abc123');
```

---

## 📊 Image Optimization

### Auto Format & Quality
Cloudinary automatically serves the best format and quality:
```
?fetch_format=auto&quality=auto
```

### Responsive Images
Generate different sizes for different devices:
```typescript
// Desktop (1200px)
getImageUrl('public_id', 1200, 800, 'fill');

// Tablet (768px)
getImageUrl('public_id', 768, 512, 'fill');

// Mobile (400px)
getImageUrl('public_id', 400, 300, 'fill');
```

### Image Transformations
```typescript
// Auto crop to square
cloudinary.url('image_id', { crop: 'auto', width: 500, height: 500 });

// Thumbnail
cloudinary.url('image_id', { crop: 'thumb', width: 200, height: 200, gravity: 'face' });

// Circular crop
cloudinary.url('image_id', { crop: 'fill', width: 300, height: 300, radius: 'max' });
```

---

## 💾 Storing Images in Database

### Option 1: Store Full URL
```typescript
// In products table
UPDATE products SET image_url = 'https://res.cloudinary.com/...' WHERE id = '...';

// Retrieve
SELECT image_url FROM products;
```

### Option 2: Store Public ID
```typescript
// In products table
UPDATE products SET image_public_id = 'shdwmen/products/abc123' WHERE id = '...';

// Generate URL on retrieval
const url = getImageUrl(row.image_public_id);
```

### Recommended: Store Both
```sql
ALTER TABLE products ADD COLUMN image_public_id VARCHAR(255);
UPDATE products SET image_public_id = 'shdwmen/products/abc123' WHERE image_url IS NOT NULL;
```

---

## 🎯 Complete Product Flow Example

### Backend (Node.js/Express)
```typescript
// In products.ts route
router.post('/', authMiddleware, requireRole(['merchant']), async (req, res) => {
  try {
    const { name, description, price, category, stock, image_url } = req.body;
    const merchantId = req.user?.userId;

    // Validate
    if (!name || !price || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create product with image URL
    const productId = uuidv4();
    await query(
      'INSERT INTO products (id, merchant_id, name, description, price, category, stock, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [productId, merchantId, name, description, price, category, stock || 0, image_url]
    );

    res.status(201).json({ message: 'Product created', product_id: productId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create product' });
  }
});
```

### Frontend (React/Next.js)
```typescript
import { uploadImage, apiCall, API_ENDPOINTS } from '@/lib/api.config';

async function createProduct(formData: FormData, imageFile: File) {
  const token = localStorage.getItem('token');

  // Step 1: Upload image
  const uploadResponse = await uploadImage(imageFile, token);
  const imageUrl = uploadResponse.url;

  // Step 2: Create product with image URL
  const product = await apiCall(
    API_ENDPOINTS.PRODUCTS.CREATE,
    'POST',
    {
      name: formData.get('name'),
      description: formData.get('description'),
      price: parseFloat(formData.get('price') as string),
      category: formData.get('category'),
      stock: parseInt(formData.get('stock') as string),
      image_url: imageUrl, // Send Cloudinary URL
    },
    token
  );

  return product;
}
```

---

## ⚙️ Configuration

### Update Cloudinary API Secret
Your `.env` has a placeholder. **Update it immediately:**

1. Go to [Cloudinary Console](https://console.cloudinary.com/console/)
2. Click "Settings" → "API Keys"
3. Copy your API Secret
4. Update `.env`:
   ```env
   CLOUDINARY_API_SECRET=your_actual_secret_here
   ```

### Folder Organization
Images are organized by folder:
- `shdwmen/products/` - Product images
- `shdwmen/gallery/` - Multiple images
- `shdwmen/` - Default folder

### File Size & Types
- **Max size:** 10MB
- **Allowed formats:** JPEG, PNG, GIF, WebP

---

## 🧪 Test Upload Endpoint

### Using Postman/Thunder Client

1. **Authenticate first** (get token from login)
2. **Create request:**
   ```
   POST http://localhost:5000/api/upload/image
   ```
3. **Set headers:**
   ```
   Authorization: Bearer <your_token_here>
   ```
4. **In Body → form-data:**
   - Key: `image`
   - Value: select image file
5. **Send!**

---

## 📝 Use Cases

### 1. Product Images
```typescript
// Upload product image
POST /api/upload/image → store URL in products.image_url
```

### 2. User Profile Pictures
```typescript
// Upload avatar
POST /api/upload/image → store URL in users.profile_image_url
```

### 3. Product Gallery
```typescript
// Upload multiple images
POST /api/upload/images → store URLs in separate gallery table
```

### 4. Message Attachments
```typescript
// Upload image in message
POST /api/upload/image → store URL in messages.attachment_url
```

### 5. User Reviews with Images
```typescript
// Upload review photo
POST /api/upload/image → store URL in reviews.image_url
```

---

## 🔒 Security Best Practices

✅ **What's Already Protected:**
- All upload endpoints require JWT authentication
- File type validation (images only)
- File size limit (10MB)
- Multer memory storage (no disk exposure)

⚠️ **Additional Recommendations:**
- Validate image dimensions
- Add rate limiting for uploads
- Scan images for malware (optional)
- Store Cloudinary URLs in database (not local files)

---

## 🐛 Troubleshooting

### "Cloudinary API Secret not configured"
**Solution:** Update `CLOUDINARY_API_SECRET` in `.env`

### "Upload endpoint returns 401 Unauthorized"
**Solution:** Make sure token is included in Authorization header

### "File too large error"
**Solution:** Check file size (max 10MB)

### "Unsupported image format"
**Solution:** Use JPEG, PNG, GIF, or WebP

### "CORS error on upload"
**Solution:** CORS is already configured, but check `CORS_ORIGIN` in .env

---

## 📚 API Reference Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/upload/image` | Upload single image |
| POST | `/api/upload/images` | Upload multiple images |
| DELETE | `/api/upload/:publicId` | Delete image |
| GET | `/api/products` | List products with images |
| POST | `/api/products` | Create product with image |
| PUT | `/api/products/:id` | Update product with new image |

---

## 🎉 You're Ready!

Image uploads are now fully integrated with:
- ✅ Cloudinary for storage & optimization
- ✅ Neon PostgreSQL for metadata
- ✅ Secure JWT authentication
- ✅ CORS enabled
- ✅ Error handling
- ✅ TypeScript support

### Start Using:
1. Start backend: `npm run dev`
2. Copy examples to frontend
3. Start uploading images!

---

**Happy uploading! 🚀**
