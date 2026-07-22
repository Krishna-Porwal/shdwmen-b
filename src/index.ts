import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { CORS_ORIGIN, PORT } from './config';
import { requestLogger } from './logger';
import logger from './logger';

// Import routes
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import orderRoutes from './routes/orders';
import cartRoutes from './routes/cart';
import wishlistRoutes from './routes/wishlist';
import userRoutes from './routes/users';
import merchantRoutes from './routes/merchant';
import categoryRoutes from './routes/categories';
import campaignRoutes from './routes/campaigns';
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
// Security and parsing middleware
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}));
app.use(helmet());
app.use(compression());
app.use(requestLogger);

// Rate limiting
const rateLimitJsonHandler = (req: express.Request, res: express.Response) => {
  res.status(429).json({ error: 'Too many requests, please try again later.' });
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler,
});

app.use('/api', apiLimiter);
app.use('/api/payments', paymentLimiter);

// Request size limits
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

// Apply Clerk JWT verification middleware globally
// This middleware extracts the token from Authorization header and attaches it to req.auth
app.use(verifyClerkToken);

// Health check route
app.get('/health', async (req, res) => {
  try {
    const { query } = await import('./db/connection');
    await query('SELECT 1');
    res.json({ status: 'ok', database: true, uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: false, uptime: process.uptime() });
  }
});

app.get('/health/detailed', async (req, res) => {
  try {
    const { query } = await import('./db/connection');
    await query('SELECT 1');
    res.json({
      database: true,
      version: process.env.npm_package_version || 'unknown',
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ database: false, version: process.env.npm_package_version || 'unknown', uptime: process.uptime() });
  }
});

app.post('/webhooks/razorpay', express.json({ limit: '5mb' }), async (req, res) => {
  logger.info({ event: 'razorpay_webhook', body: req.body }, 'Received Razorpay webhook');
  return res.status(200).json({ status: 'ok' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/users', userRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/campaigns', campaignRoutes);
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
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');
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
          logger.warn(msg + '; continuing in development mode');
        } else {
          logger.error(msg + '; exiting in production');
          process.exit(1);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Startup schema validation error');
    }

    try {
      const { checkPendingMigrations } = await import('./db/migrate');
      const { pending } = await checkPendingMigrations();
      if (pending && pending.length > 0) {
        logger.warn('There are drizzle migration files that are not yet applied. Run `npm run drizzle:migrate:checked` to apply them.');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to check pending migrations at startup');
    }

    app.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server running');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to bootstrap database before startup');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;


