const { ensureUserExists } = require('./dist/middleware/auth');
const { query } = require('./dist/db/connection');

(async () => {
  const primaryUserId = 'user_cod_primary_' + Date.now();
  const secondaryUserId = 'user_cod_secondary_' + Date.now();
  const sharedEmail = `cod-conflict-${Date.now()}@example.com`;

  await query('DELETE FROM users WHERE id = $1 OR id = $2 OR email = $3', [primaryUserId, secondaryUserId, sharedEmail]);

  await ensureUserExists(primaryUserId, sharedEmail, 'Primary Customer', '9876543210');
  const primary = await query('SELECT id, name, email, phone FROM users WHERE id = $1', [primaryUserId]);
  process.stdout.write(`PRIMARY_COUNT=${primary.rows.length}\n`);
  process.stdout.write(`PRIMARY_ROW=${JSON.stringify(primary.rows[0] || null)}\n`);

  await ensureUserExists(secondaryUserId, sharedEmail, 'Secondary Customer', '9123456780');
  const secondary = await query('SELECT id, name, email, phone FROM users WHERE id = $1', [secondaryUserId]);
  process.stdout.write(`SECONDARY_COUNT=${secondary.rows.length}\n`);
  process.stdout.write(`SECONDARY_ROW=${JSON.stringify(secondary.rows[0] || null)}\n`);

  const sharedEmailRows = await query('SELECT id, name, email FROM users WHERE email = $1', [sharedEmail]);
  process.stdout.write(`SHARED_EMAIL_COUNT=${sharedEmailRows.rows.length}\n`);
  process.stdout.write(`SHARED_EMAIL_ROWS=${JSON.stringify(sharedEmailRows.rows)}\n`);

  await query('DELETE FROM users WHERE id = $1 OR id = $2 OR email = $3', [primaryUserId, secondaryUserId, sharedEmail]);
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('SELF_TEST_ERROR', error);
    process.exit(1);
  });
