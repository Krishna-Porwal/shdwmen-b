# Backend Setup & Integration Guide

## ✅ Backend Setup Complete

The ShadowMen backend is now fully configured with Neon PostgreSQL. Here's what has been set up:

### Database
- ✅ Connected to Neon PostgreSQL
- ✅ All 8 tables created and ready
- ✅ Connection string stored in `.env`

### Backend Server
- ✅ Express.js server configured
- ✅ JWT authentication implemented
- ✅ CORS enabled for frontend communication
- ✅ TypeScript configured for type safety

### API Routes (7 route groups)
- ✅ Authentication (signup/login/verify)
- ✅ Products (CRUD + search/filter)
- ✅ Orders (create/track)
- ✅ Cart (add/update/remove)
- ✅ Wishlist (add/remove)
- ✅ User profiles
- ✅ Merchant dashboard & analytics

---

## 🚀 Running the Backend

### Development Mode
```bash
cd shdwmen-b
npm run dev
```
Server runs on `http://localhost:5000`

### Production Mode
```bash
npm run build
npm start
```

---

## 🔗 Connecting Frontend to Backend

### 1. Environment Setup (Next.js)

Create `.env.local` in `shdwmen-nextjs/`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

### 2. Update Next.js API Config

Copy `api.config.ts` from `shdwmen-b/` to `shdwmen-nextjs/lib/`:

```bash
cp shdwmen-b/api.config.ts shdwmen-nextjs/lib/api.config.ts
```

### 3. Frontend Integration Example

In your Next.js components, import and use the API:

```typescript
import { apiCall, API_ENDPOINTS } from '@/lib/api.config';

// Login
async function handleLogin(email: string, password: string) {
  const response = await apiCall(API_ENDPOINTS.AUTH.LOGIN, 'POST', {
    email,
    password,
  });
  localStorage.setItem('token', response.token);
}

// Get Products
async function getProducts() {
  const products = await apiCall(API_ENDPOINTS.PRODUCTS.LIST);
  return products;
}

// Add to Cart (requires token)
async function addToCart(productId: string, quantity: number) {
  const token = localStorage.getItem('token');
  await apiCall(
    API_ENDPOINTS.CART.ADD,
    'POST',
    { product_id: productId, quantity },
    token
  );
}
```

### 4. Store Token (Zustand)

Update your Zustand store in `shdwmen-nextjs/store/index.ts`:

```typescript
import { create } from 'zustand';

interface AuthStore {
  token: string | null;
  user: any;
  login: (token: string, user: any) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  user: null,
  login: (token: string, user: any) => {
    localStorage.setItem('token', token);
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },
}));
```

---

## 📝 Common API Usage Patterns

### Authentication Flow

```typescript
// Signup
const response = await apiCall(API_ENDPOINTS.AUTH.SIGNUP, 'POST', {
  name: 'John Doe',
  email: 'john@example.com',
  password: 'password123',
  role: 'customer', // or 'merchant'
});

// Login
const loginResponse = await apiCall(API_ENDPOINTS.AUTH.LOGIN, 'POST', {
  email: 'john@example.com',
  password: 'password123',
});

// Store token and use for subsequent requests
const token = loginResponse.token;
```

### Product Operations

```typescript
// Get all products with filters
const products = await apiCall(
  `${API_ENDPOINTS.PRODUCTS.LIST}?category=electronics&search=phone`
);

// Get single product
const product = await apiCall(API_ENDPOINTS.PRODUCTS.GET('product-id'));

// Create product (merchant)
const newProduct = await apiCall(
  API_ENDPOINTS.PRODUCTS.CREATE,
  'POST',
  {
    name: 'New Product',
    description: 'Product description',
    price: 99.99,
    category: 'electronics',
    stock: 50,
    image_url: 'https://...',
  },
  token
);
```

### Shopping Operations

```typescript
// Add to cart
await apiCall(
  API_ENDPOINTS.CART.ADD,
  'POST',
  {
    product_id: 'product-123',
    quantity: 2,
  },
  token
);

// Get cart
const cart = await apiCall(API_ENDPOINTS.CART.GET, 'GET', undefined, token);

// Create order
const order = await apiCall(
  API_ENDPOINTS.ORDERS.CREATE,
  'POST',
  {
    items: [
      { product_id: 'product-1', quantity: 2 },
      { product_id: 'product-2', quantity: 1 },
    ],
  },
  token
);
```

### Wishlist

```typescript
// Add to wishlist
await apiCall(
  API_ENDPOINTS.WISHLIST.ADD,
  'POST',
  { product_id: 'product-123' },
  token
);

// Check if product in wishlist
const { inWishlist } = await apiCall(
  API_ENDPOINTS.WISHLIST.CHECK('product-123'),
  'GET',
  undefined,
  token
);
```

### Merchant Dashboard

```typescript
// Get dashboard stats
const dashboard = await apiCall(
  API_ENDPOINTS.MERCHANT.DASHBOARD,
  'GET',
  undefined,
  token
);

// Get merchant products with sales data
const products = await apiCall(
  API_ENDPOINTS.MERCHANT.PRODUCTS,
  'GET',
  undefined,
  token
);

// Get product analytics
const analytics = await apiCall(
  API_ENDPOINTS.MERCHANT.ANALYTICS,
  'GET',
  undefined,
  token
);
```

---

## 🔐 Authentication Headers

All protected endpoints require a Bearer token:

```typescript
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
};
```

Token expires in 7 days. Include token refresh logic if needed.

---

## 🧪 Testing the Backend

### Using Postman or Thunder Client

1. **Signup**
   - POST: `http://localhost:5000/api/auth/signup`
   - Body:
   ```json
   {
     "name": "Test User",
     "email": "test@example.com",
     "password": "password123",
     "role": "customer"
   }
   ```

2. **Login**
   - POST: `http://localhost:5000/api/auth/login`
   - Body:
   ```json
   {
     "email": "test@example.com",
     "password": "password123"
   }
   ```

3. **Get Products**
   - GET: `http://localhost:5000/api/products`

4. **Protected Endpoint (requires token)**
   - Header: `Authorization: Bearer <your_token_here>`
   - GET: `http://localhost:5000/api/users/profile`

---

## 📋 Database Tables Reference

| Table | Purpose |
|-------|---------|
| `users` | User accounts (customers & merchants) |
| `products` | Product listings |
| `orders` | Customer orders |
| `order_items` | Items in each order |
| `cart_items` | Shopping cart items |
| `wishlist_items` | User wishlists |
| `reviews` | Product reviews & ratings |
| `messages` | User-to-user messaging |

---

## 🐛 Troubleshooting

### "Database connection error"
- Check `.env` DATABASE_URL
- Ensure Neon database is active
- Verify internet connection

### "Port 5000 already in use"
- Change PORT in `.env`
- Or kill the process: `lsof -ti:5000 | xargs kill -9`

### "Invalid token"
- Token may be expired (7 day expiry)
- Re-login to get new token
- Ensure token is in Authorization header

### CORS errors
- Update CORS_ORIGIN in `.env` to match frontend URL
- Restart backend server after changes

---

## 📦 Deployment Ready

The backend is production-ready. For deployment:

1. Set environment variables on hosting platform
2. Run `npm run build`
3. Run `npm start`
4. Update frontend API_URL to production backend URL

---

## 📚 Additional Resources

- [Express.js Docs](https://expressjs.com/)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Neon Documentation](https://neon.tech/docs/)
- [JWT Documentation](https://jwt.io/)

---

**Backend Setup Complete! You can now start developing your e-commerce platform.** 🎉
