import express, { Express } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import pool from './db/connection';
import { CORS_ORIGIN, PORT } from './config';

// Import routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import orderRoutes from './routes/orders';
import cartRoutes from './routes/cart';
import wishlistRoutes from './routes/wishlist';
import userRoutes from './routes/users';
import merchantRoutes from './routes/merchant';
import uploadRoutes from './routes/upload';
import trackingRoutes from './routes/tracking';
import reviewRoutes from './routes/reviews';
import testRoutes from './routes/test';
import paymentRoutes from './routes/payments';
import notificationRoutes from './routes/notifications';
import adminRoutes from './routes/admin';
import merchantExportRoutes from './routes/merchant_export';
import { createTables } from './db/migrate';
import { formatServerError } from './utils/apiError';

// Import authentication middleware (Clerk JWT verification)
import { verifyClerkToken } from './middleware/auth';

const app: Express = express();

// Middleware
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Apply Clerk JWT verification middleware globally
// This middleware extracts the token from Authorization header and attaches it to req.auth
app.use(verifyClerkToken);

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/users', userRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/test', testRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchant', merchantExportRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json(formatServerError(err, 'Internal Server Error'));
});

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
  try {
    await createTables();
    // Validate critical schema pieces after table creation
    try {
      const { validateSchema } = await import('./db/migrate');
      const { soldCountColumn } = await validateSchema();
      if (!soldCountColumn) {
        const isDev = process.env.NODE_ENV !== 'production';
        const msg = 'Critical column products.sold_count is missing';
        if (isDev) {
          console.warn(msg + '; continuing in development mode');
        } else {
          console.error(msg + '; exiting in production');
          process.exit(1);
        }
      }
    } catch (err) {
      console.error('Startup schema validation error:', err);
    }

    try {
      const { checkPendingMigrations } = await import('./db/migrate');
      const { pending } = await checkPendingMigrations();
      if (pending && pending.length > 0) {
        console.warn('There are drizzle migration files that are not yet applied. Run `npm run drizzle:migrate:checked` to apply them.');
      }
    } catch (err) {
      console.error('Failed to check pending migrations at startup:', err);
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to bootstrap database before startup:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
