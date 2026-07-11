# ShadowMen Backend API

A Node.js/Express backend API for the ShadowMen e-commerce platform with PostgreSQL (Neon) database integration.

## Features

- ✅ User authentication (signup/login with JWT)
- ✅ Product management (CRUD operations)
- ✅ Shopping cart functionality
- ✅ Orders & order tracking
- ✅ Wishlist management
- ✅ Merchant dashboard & analytics
- ✅ User profile management
- ✅ **Image uploads with Cloudinary**
- ✅ PostgreSQL with Neon
- ✅ TypeScript support
- ✅ CORS enabled

## Prerequisites

- Node.js 16+ 
- npm or yarn
- PostgreSQL database (Neon)

## Installation

1. **Clone or navigate to the project**
```bash
cd shdwmen-b
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
- Copy `.env.example` to `.env`
- Update the `DATABASE_URL` with your Neon connection string
- Update `JWT_SECRET` for production

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
PORT=5000
NODE_ENV=development
JWT_SECRET=your_secret_key
CORS_ORIGIN=http://localhost:3000
```

4. **Create database tables**
```bash
npm run migrate
```

## Development

Start the development server:
```bash
npm run dev
```

The server will run on `http://localhost:5000`

## Production Build

Build the TypeScript to JavaScript:
```bash
npm run build
```

Start the production server:
```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/verify` - Verify JWT token

### Products
- `GET /api/products` - Get all products (with search & category filters)
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create product (merchant only)
- `PUT /api/products/:id` - Update product (merchant only)
- `DELETE /api/products/:id` - Delete product (merchant only)

### Orders
- `GET /api/orders` - Get user orders
- `GET /api/orders/:id` - Get order details
- `POST /api/orders` - Create order
- `PATCH /api/orders/:id/status` - Update order status

### Cart
- `GET /api/cart` - Get cart items
- `POST /api/cart/add` - Add item to cart
- `PUT /api/cart/:id` - Update cart item quantity
- `DELETE /api/cart/:id` - Remove from cart
- `POST /api/cart/clear` - Clear entire cart

### Wishlist
- `GET /api/wishlist` - Get wishlist items
- `POST /api/wishlist/add` - Add to wishlist
- `DELETE /api/wishlist/:id` - Remove from wishlist
- `GET /api/wishlist/check/:product_id` - Check if product in wishlist

### User
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `POST /api/users/change-password` - Change password
- `GET /api/users/:id` - Get user by ID

### Merchant
- `GET /api/merchant/dashboard` - Merchant dashboard stats
- `GET /api/merchant/products` - Get merchant products
- `GET /api/merchant/orders` - Get merchant orders
- `GET /api/merchant/orders/:id` - Get merchant order details
- `GET /api/merchant/analytics/products` - Product analytics
- `GET /api/merchant/reviews` - Get product reviews

### Upload (Cloudinary)
- `POST /api/upload/image` - Upload single image
- `POST /api/upload/images` - Upload multiple images (max 5)
- `DELETE /api/upload/:publicId` - Delete image

## Database Schema

### Tables
- **users** - User accounts with roles (customer/merchant)
- **products** - Product listings with merchant association
- **orders** - Customer orders
- **order_items** - Individual items in orders
- **cart_items** - Shopping cart items
- **wishlist_items** - Wishlist entries
- **reviews** - Product reviews and ratings
- **messages** - User messages

## Configuration

The API uses JWT (JSON Web Tokens) for authentication. 
- Include the token in the `Authorization` header: `Bearer <token>`
- Tokens expire in 7 days

### Cloudinary Setup
For image uploads, configure Cloudinary credentials in `.env`:
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```
See [CLOUDINARY_GUIDE.md](./CLOUDINARY_GUIDE.md) for detailed setup and usage.

## Project Structure

```
src/
├── index.ts              # Main server file
├── db/
│   ├── connection.ts     # Database connection pool
│   └── migrate.ts        # Schema creation
├── middleware/
│   └── auth.ts           # JWT authentication middleware
└── routes/
    ├── auth.ts           # Authentication routes
    ├── products.ts       # Product routes
    ├── orders.ts         # Order routes
    ├── cart.ts           # Cart routes
    ├── wishlist.ts       # Wishlist routes
    ├── users.ts          # User routes
    └── merchant.ts       # Merchant routes
```

## Error Handling

The API returns appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `409` - Conflict (e.g., email already exists)
- `500` - Server error

## Security Notes

⚠️ **Important for production:**
- Always use a strong, unique `JWT_SECRET`
- Set `NODE_ENV=production`
- Use HTTPS in production
- Implement rate limiting
- Add input validation
- Consider adding request logging

## Development Tips

- Use `npm run dev` for hot reload during development
- Database changes require table migrations
- Check logs for debugging database connection issues
- Test endpoints with Postman or Thunder Client

## License

MIT
