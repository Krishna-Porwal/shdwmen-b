import { Pool, QueryResult } from 'pg';
import { DATABASE_URL } from '../config';
import logger from '../logger';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Database connection error:', err);
  } else {
    logger.info('Database connected successfully at:', res.rows[0]);
  }
});

export const query = (text: string, params?: any[]): Promise<QueryResult> => {
  return pool.query(text, params);
};

export const getClient = async () => {
  return pool.connect();
};

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export default pool;
