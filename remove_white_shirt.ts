import { query } from './src/db/connection';
(async () => {
  try {
    const id = '6912778b-b4f4-4695-b101-146b77e61323';
    await query('UPDATE products SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['inactive', id]);
    const res = await query('SELECT id, name, price, status, image_url, imgs FROM products WHERE id = $1', [id]);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  process.exit(0);
})();
