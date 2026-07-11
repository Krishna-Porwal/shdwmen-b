import { query } from './connection';

const createTables = async () => {
  try {
    console.log('Creating tables...');

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
    console.log('✓ Users table created');

    // Add missing columns to users table if they don't exist
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255);`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255);`);
      console.log('✓ Merchant columns added to users table');
    } catch (altErr) {
      // Columns might already exist
      console.log('ℹ Merchant columns already exist or error adding them');
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
        sold_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Products table created');

    // Orders table
    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        shipping_address JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Orders table created');

    // Order items table
    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Order items table created');

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
    console.log('✓ Cart items table created');

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
    console.log('✓ Wishlist table created');

    // Reviews table
    await query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id),
        rating INT CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Reviews table created');

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
    console.log('✓ Messages table created');

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
    console.log('✓ User Activity table created');

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
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address JSONB DEFAULT '{}';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cod';`);
      await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id VARCHAR(255);`);
      console.log('✓ product JSONB, metadata and payment columns ensured');
    } catch (imgErr) {
      console.log('ℹ product metadata columns already exist or error adding them');
    }

    // Convert legacy UUID-based user IDs to VARCHAR(255) for Clerk compatibility
    try {
      console.log('Checking users.id column type for Clerk ID compatibility...');
      const usersIdType = await query(
        `SELECT udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'`
      );

      if (usersIdType.rows.length && usersIdType.rows[0].udt_name === 'uuid') {
        console.log('Converting users.id from uuid to varchar(255)');

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

        console.log('✓ Converted user ID columns and updated foreign key constraints');
      } else {
        console.log('users.id column already compatible with Clerk IDs, no conversion needed');
      }
    } catch (conversionError) {
      console.error('Error converting user ID column types:', conversionError);
    }

    console.log('\n✅ All tables created successfully!');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
};

createTables().then(() => process.exit(0));
