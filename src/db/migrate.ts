import { query } from './connection';
import fs from 'fs';
import path from 'path';
import logger from '../logger';

export const createTables = async () => {
  try {
    logger.info('Creating tables...');

    // Users table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        role VARCHAR(50) DEFAULT 'customer',
        phone VARCHAR(20),
        address TEXT,
        shop_name VARCHAR(255),
        owner_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Users table created');

    // Add missing columns to users table if they don't exist
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255);`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255);`);
      logger.info('✓ Merchant columns added to users table');
    } catch (altErr) {
      // Columns might already exist
      logger.info('ℹ Merchant columns already exist or error adding them');
    }

    // Products table
    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(255) NOT NULL REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        brand VARCHAR(255),
        category_top VARCHAR(50),
        category VARCHAR(100),
        gender VARCHAR(50),
        tags TEXT[] DEFAULT '{}',
        mrp DECIMAL(10, 2) DEFAULT 0,
        price DECIMAL(10, 2) NOT NULL,
        estimated_delivery_days INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        is_sponsored BOOLEAN DEFAULT false,
        image_url VARCHAR(255),
        imgs TEXT[] DEFAULT '{}',
        images JSONB DEFAULT '[]',
        size_stock JSONB DEFAULT '[]',
        stock INT DEFAULT 0,
        avg_rating DECIMAL(3, 2) DEFAULT 0,
        review_count INT DEFAULT 0,
        sold_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Products table created');

    // Orders table
    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_method VARCHAR(50) DEFAULT 'cod',
        payment_id VARCHAR(255),
        razorpay_order_id VARCHAR(255),
        razorpay_signature TEXT,
        payment_status VARCHAR(50) DEFAULT 'pending',
        shipping_address JSONB DEFAULT '{}',
        address_snapshot JSONB DEFAULT '{}',
        order_snapshot JSONB DEFAULT '[]',
        estimated_delivery_date TIMESTAMP,
        cancelled_at TIMESTAMP,
        delivered_at TIMESTAMP,
        refund_id VARCHAR(255),
        refund_amount DECIMAL(10, 2) DEFAULT 0,
        refund_status VARCHAR(50),
        refund_initiated_at TIMESTAMP,
        expected_refund_date TIMESTAMP,
        refund_completed_at TIMESTAMP,
        refund_meta JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Orders table created');

    // Order items table
    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        product_snapshot JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Order items table created');

    await query(`
      CREATE TABLE IF NOT EXISTS order_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        previous_status VARCHAR(50),
        new_status VARCHAR(50) NOT NULL,
        note TEXT,
        changed_by VARCHAR(255) REFERENCES users(id),
        changed_by_role VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        actor_id VARCHAR(255) REFERENCES users(id),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(255),
        is_read BOOLEAN DEFAULT false,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id),
        actor_id VARCHAR(255) REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refunds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
        refund_id VARCHAR(255) UNIQUE,
        refund_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
        refund_status VARCHAR(50) NOT NULL DEFAULT 'initiated',
        refund_initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expected_refund_date TIMESTAMP,
        refund_completed_at TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        order_id UUID REFERENCES orders(id),
        request_hash VARCHAR(255),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);
    logger.info('✓ Order workflow tables created');

    // Cart table
    await query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      );
    `);
    logger.info('✓ Cart items table created');

    // Wishlist table
    await query(`
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        product_id UUID NOT NULL REFERENCES products(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      );
    `);
    logger.info('✓ Wishlist table created');

    // Reviews table
    await query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Reviews table created');

    await query(`
      CREATE TABLE IF NOT EXISTS review_replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        merchant_id VARCHAR(255) NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Review replies table created');

    // Categories table for merchant-managed custom categories
    await query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(255) NOT NULL REFERENCES users(id),
        name VARCHAR(100) NOT NULL,
        top_category VARCHAR(50),
        gender VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Categories table created');

    // Campaigns table for merchant sale campaigns and premium bundles
    await query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(255) NOT NULL REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        title VARCHAR(255),
        headline VARCHAR(255),
        offer_text VARCHAR(255),
        subtitle TEXT,
        button_text VARCHAR(255),
        button_link VARCHAR(255),
        description TEXT,
        category_top VARCHAR(50),
        category VARCHAR(100),
        gender VARCHAR(50),
        discount_percent INT DEFAULT 0,
        discount_type VARCHAR(50) DEFAULT 'percent',
        discount_value DECIMAL(10, 2) DEFAULT 0,
        banner_image VARCHAR(255),
        product_ids UUID[] DEFAULT '{}',
        selected_categories TEXT[] DEFAULT '{}',
        product_selection_mode VARCHAR(50) DEFAULT 'category',
        status VARCHAR(50) DEFAULT 'draft',
        active BOOLEAN DEFAULT false,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Campaigns table created');

    // Messages table
    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id VARCHAR(255) NOT NULL REFERENCES users(id),
        receiver_id VARCHAR(255) NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('✓ Messages table created');

    // User Activity Tracking table
    await query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) REFERENCES users(id),
        product_id UUID REFERENCES products(id),
        activity_type VARCHAR(50) NOT NULL,
        ip_address VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_activity_user_product ON user_activity(user_id, product_id);
      CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(activity_type);
      CREATE INDEX IF NOT EXISTS idx_user_activity_product ON user_activity(product_id);
    `);
    logger.info('✓ User Activity table created');

    // Add necessary JSONB columns to products if they don't exist
    try {
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS imgs TEXT[] DEFAULT '{}';`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(255);`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS size_stock JSONB DEFAULT '[]';`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_top VARCHAR(50);`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS gender VARCHAR(50);`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp DECIMAL(10, 2) DEFAULT 0;`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS estimated_delivery_days INT DEFAULT 0;`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url VARCHAR(255);`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sponsored BOOLEAN DEFAULT false;`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0;`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS title VARCHAR(255);`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS headline VARCHAR(255);`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS offer_text VARCHAR(255);`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS subtitle TEXT;`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS button_text VARCHAR(255);`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS button_link VARCHAR(255);`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS discount_type VARCHAR(50) DEFAULT 'percent';`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10, 2) DEFAULT 0;`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS selected_categories TEXT[] DEFAULT '{}';`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS product_selection_mode VARCHAR(50) DEFAULT 'category';`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'draft';`);
      await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address JSONB DEFAULT '{}';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_snapshot JSONB DEFAULT '{}';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_snapshot JSONB DEFAULT '[]';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cod';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_date TIMESTAMP;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10, 2) DEFAULT 0;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status VARCHAR(50);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_initiated_at TIMESTAMP;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_refund_date TIMESTAMP;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_completed_at TIMESTAMP;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_meta JSONB DEFAULT '{}';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason_type VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255);`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;`);
      await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_snapshot JSONB DEFAULT '{}';`);
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;`);
      logger.info('✓ product JSONB, metadata and payment columns ensured');
    } catch (imgErr) {
      logger.info('ℹ product metadata columns already exist or error adding them');
    }

    try {
      // Create a partial unique index on payment_id so that multiple NULLs are allowed,
      // but real payment ids are enforced unique to prevent duplicate order creation.
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_id_unique ON orders(payment_id) WHERE payment_id IS NOT NULL;`);

      await query(`CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id, status, created_at DESC);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_status_history_order_created ON order_status_history(order_id, created_at DESC);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_order_created ON audit_logs(order_id, created_at DESC);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_products_is_deleted ON products(is_deleted);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);`);
    } catch (indexErr) {
      logger.info('ℹ Some workflow indexes already exist or could not be created');
    }

    // Convert legacy UUID-based user IDs to VARCHAR(255) for Clerk compatibility
    try {
      logger.info('Checking users.id column type for Clerk ID compatibility...');
      const usersIdType = await query(
        `SELECT udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'`
      );

      if (usersIdType.rows.length && usersIdType.rows[0].udt_name === 'uuid') {
        logger.info('Converting users.id from uuid to varchar(255)');

        const foreignKeys = [
          { table: 'products', column: 'merchant_id', constraint: 'products_merchant_id_fkey' },
          { table: 'orders', column: 'user_id', constraint: 'orders_user_id_fkey' },
          { table: 'cart_items', column: 'user_id', constraint: 'cart_items_user_id_fkey' },
          { table: 'wishlist_items', column: 'user_id', constraint: 'wishlist_items_user_id_fkey' },
          { table: 'reviews', column: 'user_id', constraint: 'reviews_user_id_fkey' },
          { table: 'messages', column: 'sender_id', constraint: 'messages_sender_id_fkey' },
          { table: 'messages', column: 'receiver_id', constraint: 'messages_receiver_id_fkey' },
          { table: 'user_activity', column: 'user_id', constraint: 'user_activity_user_id_fkey' },
        ];

        for (const fk of foreignKeys) {
          await query(`ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.constraint};`);
          await query(`ALTER TABLE ${fk.table} ALTER COLUMN ${fk.column} TYPE VARCHAR(255) USING ${fk.column}::text;`);
        }

        await query(`ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(255) USING id::text;`);

        for (const fk of foreignKeys) {
          await query(`ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.constraint} FOREIGN KEY (${fk.column}) REFERENCES users(id);`);
        }

        logger.info('✓ Converted user ID columns and updated foreign key constraints');
      } else {
        logger.info('users.id column already compatible with Clerk IDs, no conversion needed');
      }
    } catch (conversionError) {
      logger.error('Error converting user ID column types:', conversionError);
    }

    // Keep product and order item IDs as UUID for current schema compatibility

    logger.info('\n✅ All tables created successfully!');
  } catch (error) {
    logger.error('Error creating tables:', error);
  }
};

export async function validateSchema() {
  try {
    const { query } = await import('./connection');

    const requiredTables = ['products', 'orders', 'order_items', 'notifications', 'refunds', 'audit_logs'];
    const requiredColumns: { table: string; column: string }[] = [
      { table: 'products', column: 'sold_count' },
      { table: 'orders', column: 'payment_status' },
      { table: 'orders', column: 'status' },
      { table: 'orders', column: 'refund_status' },
    ];
    const requiredIndexes = [
      { table: 'orders', index: 'idx_orders_user_status_created' },
      { table: 'orders', index: 'idx_orders_payment_id' },
    ];

    const missingTables: string[] = [];
    const missingColumns: Array<{ table: string; column: string }> = [];
    const missingIndexes: Array<{ table: string; index: string }> = [];

    // Check tables
    const tablesRes = await query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [requiredTables]
    );
    const existingTables = new Set(tablesRes.rows.map((r: any) => r.table_name));
    for (const t of requiredTables) if (!existingTables.has(t)) missingTables.push(t);

    // Check columns
    for (const c of requiredColumns) {
      try {
        const r = await query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [c.table, c.column]
        );
        if (r.rows.length === 0) missingColumns.push(c);
      } catch (err) {
        missingColumns.push(c);
      }
    }

    // Check indexes
    for (const ix of requiredIndexes) {
      try {
        const r = await query(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
          [ix.table, ix.index]
        );
        if (r.rows.length === 0) missingIndexes.push(ix);
      } catch (err) {
        missingIndexes.push(ix);
      }
    }

    return {
      productsTable: existingTables.has('products'),
      ordersTable: existingTables.has('orders'),
      notificationsTable: existingTables.has('notifications'),
      refundsTable: existingTables.has('refunds'),
      soldCountColumn: !missingColumns.some((c) => c.table === 'products' && c.column === 'sold_count'),
      missingTables,
      missingColumns,
      missingIndexes,
    };
  } catch (error) {
    logger.error('Schema validation failed:', error);
    return {
      productsTable: false,
      ordersTable: false,
      notificationsTable: false,
      refundsTable: false,
      soldCountColumn: false,
      missingTables: [],
      missingColumns: [],
      missingIndexes: [],
    };
  }
}

export async function checkPendingMigrations() {
  try {
    const migrationsDir = path.resolve(__dirname, '..', '..', 'drizzle');
    const metaPath = path.resolve(migrationsDir, 'meta', '_journal.json');
    const files = await fs.promises.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql') || f.endsWith('.ts')).map((f) => f.replace(/\.[^.]+$/, ''));

    let appliedTags: string[] = [];
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
      appliedTags = (meta.entries || []).map((e: any) => e.tag).filter(Boolean);
    }

    const pending = sqlFiles.filter((f) => !appliedTags.includes(f));
    if (pending.length > 0) {
      logger.warn('⚠️ Pending drizzle migrations detected:', pending);
    } else {
      logger.info('✓ No pending drizzle migrations');
    }
    return { pending, applied: appliedTags };
  } catch (err) {
    logger.error('Failed to check pending migrations:', err);
    return { pending: [], applied: [] };
  }
}

if (require.main === module) {
  createTables()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}
