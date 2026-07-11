import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth, requireMerchant } from '../middleware/auth';

const router: Router = express.Router();

/**
 * Test endpoint to verify complete product lifecycle
 * GET /api/test/product-lifecycle
 * Returns diagnostic info about the system
 */
router.get('/product-lifecycle', async (req: Request, res: Response) => {
  try {
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      checks: {},
    };

    // Check 1: Database connection
    try {
      const connResult = await query('SELECT NOW()');
      diagnostics.checks.database = {
        status: 'ok',
        timestamp: connResult.rows[0].now,
      };
    } catch (error: any) {
      diagnostics.checks.database = { status: 'failed', error: error.message };
    }

    // Check 2: Tables exist
    try {
      const tablesResult = await query(
        `SELECT table_name FROM information_schema.tables 
         WHERE table_schema = 'public' 
         ORDER BY table_name`
      );
      diagnostics.checks.tables = {
        status: 'ok',
        count: tablesResult.rows.length,
        tables: tablesResult.rows.map((r: any) => r.table_name),
      };
    } catch (error: any) {
      diagnostics.checks.tables = { status: 'failed', error: error.message };
    }

    // Check 3: Products table schema
    try {
      const schemaResult = await query(
        `SELECT column_name, data_type FROM information_schema.columns 
         WHERE table_name = 'products' 
         ORDER BY ordinal_position`
      );
      diagnostics.checks.productSchema = {
        status: 'ok',
        columns: schemaResult.rows.map((r: any) => ({
          name: r.column_name,
          type: r.data_type,
        })),
      };
    } catch (error: any) {
      diagnostics.checks.productSchema = {
        status: 'failed',
        error: error.message,
      };
    }

    // Check 4: Sample products
    try {
      const productsResult = await query('SELECT COUNT(*) as count FROM products');
      const sampleResult = await query(
        'SELECT id, name, price, image_url, is_sponsored, avg_rating, sold_count FROM products LIMIT 3'
      );
      diagnostics.checks.products = {
        status: 'ok',
        totalCount: parseInt(productsResult.rows[0].count),
        sampleProducts: sampleResult.rows,
      };
    } catch (error: any) {
      diagnostics.checks.products = { status: 'failed', error: error.message };
    }

    // Check 5: Users with roles
    try {
      const usersResult = await query(
        'SELECT role, COUNT(*) as count FROM users GROUP BY role'
      );
      diagnostics.checks.users = {
        status: 'ok',
        byRole: usersResult.rows,
      };
    } catch (error: any) {
      diagnostics.checks.users = { status: 'failed', error: error.message };
    }

    // Check 6: Orders and order items
    try {
      const ordersResult = await query('SELECT COUNT(*) as count FROM orders');
      const itemsResult = await query('SELECT COUNT(*) as count FROM order_items');
      diagnostics.checks.orders = {
        status: 'ok',
        totalOrders: parseInt(ordersResult.rows[0].count),
        totalOrderItems: parseInt(itemsResult.rows[0].count),
      };
    } catch (error: any) {
      diagnostics.checks.orders = { status: 'failed', error: error.message };
    }

    // Check 7: Reviews and ratings
    try {
      const reviewsResult = await query('SELECT COUNT(*) as count FROM reviews');
      const avgRatingResult = await query(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews'
      );
      diagnostics.checks.reviews = {
        status: 'ok',
        totalReviews: parseInt(reviewsResult.rows[0].count),
        averageRating: parseFloat(avgRatingResult.rows[0].avg_rating) || 0,
      };
    } catch (error: any) {
      diagnostics.checks.reviews = { status: 'failed', error: error.message };
    }

    // Check 8: User activity tracking
    try {
      const activityResult = await query('SELECT COUNT(*) as count FROM user_activity');
      const typesResult = await query(
        'SELECT activity_type, COUNT(*) as count FROM user_activity GROUP BY activity_type'
      );
      diagnostics.checks.userActivity = {
        status: 'ok',
        totalActivities: parseInt(activityResult.rows[0].count),
        byType: typesResult.rows,
      };
    } catch (error: any) {
      diagnostics.checks.userActivity = { status: 'failed', error: error.message };
    }

    // Check 9: Cloudinary configuration
    diagnostics.checks.cloudinary = {
      cloudNameConfigured: !!process.env.CLOUDINARY_CLOUD_NAME,
      apiKeyConfigured: !!process.env.CLOUDINARY_API_KEY,
      apiSecretConfigured: !!process.env.CLOUDINARY_API_SECRET,
    };

    res.json(diagnostics);
  } catch (error) {
    console.error('Lifecycle test error:', error);
    res.status(500).json({ error: 'Failed to run diagnostic tests' });
  }
});

/**
 * Get full data integrity report
 * GET /api/test/data-integrity
 */
router.get('/data-integrity', async (req: Request, res: Response) => {
  try {
    const report: any = {
      timestamp: new Date().toISOString(),
      issues: [],
      warnings: [],
    };

    // Check for products with null image_url
    const nullImagesResult = await query(
      'SELECT COUNT(*) as count FROM products WHERE image_url IS NULL'
    );
    if (parseInt(nullImagesResult.rows[0].count) > 0) {
      report.warnings.push(
        `${nullImagesResult.rows[0].count} products have null image_url`
      );
    }

    // Check for orphaned order items
    const orphanedItemsResult = await query(
      `SELECT COUNT(*) as count FROM order_items oi 
       LEFT JOIN products p ON oi.product_id = p.id 
       WHERE p.id IS NULL`
    );
    if (parseInt(orphanedItemsResult.rows[0].count) > 0) {
      report.issues.push(
        `${orphanedItemsResult.rows[0].count} orphaned order items detected`
      );
    }

    // Check for orphaned reviews
    const orphanedReviewsResult = await query(
      `SELECT COUNT(*) as count FROM reviews r 
       LEFT JOIN products p ON r.product_id = p.id 
       WHERE p.id IS NULL`
    );
    if (parseInt(orphanedReviewsResult.rows[0].count) > 0) {
      report.issues.push(
        `${orphanedReviewsResult.rows[0].count} orphaned reviews detected`
      );
    }

    // Check avg_rating consistency
    const ratingMismatchResult = await query(
      `SELECT p.id, p.name, p.avg_rating, 
              AVG(r.rating) as actual_avg 
       FROM products p
       LEFT JOIN reviews r ON p.id = r.product_id
       GROUP BY p.id, p.name, p.avg_rating
       HAVING AVG(r.rating) IS NOT NULL 
       AND ABS(p.avg_rating - AVG(r.rating)) > 0.1`
    );
    if (ratingMismatchResult.rows.length > 0) {
      report.warnings.push(
        `${ratingMismatchResult.rows.length} products have inconsistent avg_rating`
      );
    }

    // Check merchant products ownership
    const merchantCheckResult = await query(
      `SELECT COUNT(*) as count FROM products p 
       WHERE p.merchant_id IS NULL 
       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.merchant_id AND u.role = 'merchant')`
    );
    if (parseInt(merchantCheckResult.rows[0].count) > 0) {
      report.issues.push(
        `${merchantCheckResult.rows[0].count} products lack valid merchant`
      );
    }

    res.json(report);
  } catch (error) {
    console.error('Data integrity test error:', error);
    res.status(500).json({ error: 'Failed to run data integrity tests' });
  }
});

export default router;
