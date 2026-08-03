const { ensureUserExists } = require('./src/middleware/auth');
const { query } = require('./src/db/connection');

(async () => {
  const testId = 'user_test_checkout_fix';
  const testEmail = `checkout-fix-${Date.now()}@example.com`;
  await query('DELETE FROM users WHERE id = $1', [testId]);

  await ensureUserExists(testId, testEmail, undefined, undefined);
  const first = await query('SELECT id, name, email, phone FROM users WHERE id = $1 OR email = $2', [testId, testEmail]);
  console.log('FIRST_COUNT', first.rows.length);
  console.log('FIRST_ROW_JSON', JSON.stringify(first.rows[0] || null));

  await ensureUserExists(testId, testEmail, undefined, undefined);
  const second = await query('SELECT id, name, email, phone FROM users WHERE id = $1 OR email = $2', [testId, testEmail]);
  console.log('SECOND_COUNT', second.rows.length);
  console.log('SECOND_ROW_JSON', JSON.stringify(second.rows[0] || null));

  await query('DELETE FROM users WHERE id = $1', [testId]);
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
