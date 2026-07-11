/**
 * Setup demo merchant account
 * Run this once to create merchant@example.com / password123
 */

import bcrypt from 'bcryptjs';
import { query } from './src/db/connection';
import { v4 as uuidv4 } from 'uuid';

async function setupDemoMerchant() {
  try {
    // Check if merchant already exists
    const existing = await query(
      'SELECT * FROM users WHERE email = $1',
      ['merchant@example.com']
    );

    if (existing.rows.length > 0) {
      console.log('✓ Demo merchant account already exists');
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create merchant user
    const merchantId = uuidv4();
    await query(
      'INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)',
      [merchantId, 'Demo Merchant', 'merchant@example.com', hashedPassword, 'merchant']
    );

    console.log('✓ Demo merchant account created');
    console.log('  Email: merchant@example.com');
    console.log('  Password: password123');
    console.log('  Merchant ID:', merchantId);

    process.exit(0);
  } catch (error) {
    console.error('✗ Error setting up demo merchant:', error);
    process.exit(1);
  }
}

setupDemoMerchant();
