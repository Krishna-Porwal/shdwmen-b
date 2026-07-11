// ============================================
// CLOUDINARY IMAGE UPLOAD - FRONTEND EXAMPLES
// ============================================

import { uploadImage, uploadMultipleImages, deleteImage } from '@/lib/api.config';

/**
 * Example 1: Single Image Upload Component
 */
export default function ImageUploadForm() {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!image) return;

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login first');
      return;
    }

    setUploading(true);
    try {
      const response = await uploadImage(image, token);
      setImageUrl(response.url);
      console.log('Image uploaded:', response);
      alert('Image uploaded successfully!');
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-form">
      <input
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        disabled={uploading}
      />
      {preview && <img src={preview} alt="Preview" width={200} />}
      <button onClick={handleUpload} disabled={!image || uploading}>
        {uploading ? 'Uploading...' : 'Upload Image'}
      </button>
      {imageUrl && (
        <div>
          <p>Image URL: {imageUrl}</p>
          <img src={imageUrl} alt="Uploaded" width={200} />
        </div>
      )}
    </div>
  );
}

/**
 * Example 2: Product Creation with Image Upload
 */
export function CreateProductForm() {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: 0,
    category: '',
    stock: 0,
    image_url: '',
  });
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setImage(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) return;

    setLoading(true);
    try {
      // Step 1: Upload image
      let imageUrl = formData.image_url;
      if (image) {
        const uploadResponse = await uploadImage(image, token);
        imageUrl = uploadResponse.url;
      }

      // Step 2: Create product with image URL
      const response = await fetch('http://localhost:5000/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          image_url: imageUrl,
        }),
      });

      if (response.ok) {
        alert('Product created successfully!');
        setFormData({
          name: '',
          description: '',
          price: 0,
          category: '',
          stock: 0,
          image_url: '',
        });
        setImage(null);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to create product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Product Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        required
      />
      <textarea
        placeholder="Description"
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
      />
      <input
        type="number"
        placeholder="Price"
        value={formData.price}
        onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
        required
      />
      <input
        type="text"
        placeholder="Category"
        value={formData.category}
        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
        required
      />
      <input
        type="number"
        placeholder="Stock"
        value={formData.stock}
        onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
        required
      />
      <input
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Product'}
      </button>
    </form>
  );
}

/**
 * Example 3: Multiple Images Upload
 */
export function GalleryUpload() {
  const [images, setImages] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<any[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setImages((prev) => [...prev, ...files].slice(0, 5)); // Max 5 images
  };

  const handleUpload = async () => {
    if (images.length === 0) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    setUploading(true);
    try {
      const response = await uploadMultipleImages(images, token);
      setUploadedImages(response.images);
      setImages([]);
      alert(`${response.count} images uploaded successfully!`);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload images');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        disabled={uploading}
      />
      <p>Selected: {images.length} images</p>
      <button onClick={handleUpload} disabled={images.length === 0 || uploading}>
        {uploading ? 'Uploading...' : 'Upload All'}
      </button>

      <div>
        {uploadedImages.map((img, idx) => (
          <div key={idx}>
            <img src={img.url} alt="Uploaded" width={150} />
            <p>{img.url}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Example 4: Image Upload Hook (Reusable)
 */
export function useImageUpload() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = async (file: File): Promise<string | null> => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Not authenticated');
        return null;
      }

      const response = await uploadImage(file, token);
      return response.url;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const deleteFile = async (publicId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Not authenticated');
        return false;
      }

      await deleteImage(publicId, token);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { uploadFile, deleteFile, loading, error };
}

/**
 * Example 5: Using the upload hook in a component
 */
export function ProductImageEditor() {
  const [images, setImages] = useState<Array<{ url: string; publicId: string }>>([]);
  const { uploadFile, deleteFile, loading } = useImageUpload();

  const handleAddImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = await uploadFile(file);
    if (url) {
      // Extract public ID from URL (simplified)
      const publicId = url.split('/').pop()?.split('.')[0] || '';
      setImages((prev) => [...prev, { url, publicId }]);
    }
  };

  const handleDeleteImage = async (publicId: string) => {
    const success = await deleteFile(publicId);
    if (success) {
      setImages((prev) => prev.filter((img) => img.publicId !== publicId));
    }
  };

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        onChange={handleAddImage}
        disabled={loading}
      />
      <div className="image-grid">
        {images.map((img) => (
          <div key={img.publicId}>
            <img src={img.url} alt="Product" width={150} />
            <button onClick={() => handleDeleteImage(img.publicId)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Example 6: Storing image URL in product database
 */
export async function createProductWithImage(
  productData: {
    name: string;
    description: string;
    price: number;
    category: string;
    stock: number;
  },
  imageFile: File
) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');

  try {
    // Upload image first
    const uploadResponse = await uploadImage(imageFile, token);
    const imageUrl = uploadResponse.url;
    const publicId = uploadResponse.publicId;

    // Create product with image URL
    const response = await fetch('http://localhost:5000/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...productData,
        image_url: imageUrl, // Store in database
      }),
    });

    if (!response.ok) throw new Error('Failed to create product');

    const productResponse = await response.json();
    return {
      product: productResponse.product,
      imageUrl,
      publicId,
    };
  } catch (error) {
    console.error('Error creating product:', error);
    throw error;
  }
}

/**
 * Example 7: Drag and drop upload
 */
export function DragDropUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const { uploadFile, loading } = useImageUpload();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find((file) => file.type.startsWith('image/'));

    if (imageFile) {
      const url = await uploadFile(imageFile as File);
      if (url) setUploadedUrl(url);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        border: isDragging ? '2px solid blue' : '2px dashed gray',
        padding: '20px',
        cursor: 'pointer',
      }}
    >
      <p>Drag and drop images here</p>
      {loading && <p>Uploading...</p>}
      {uploadedUrl && <img src={uploadedUrl} alt="Uploaded" width={200} />}
    </div>
  );
}
