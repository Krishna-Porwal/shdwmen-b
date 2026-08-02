const { query } = require('./dist/db/connection.js');

(async () => {
  try {
    const result = await query(
      'UPDATE reviews SET rating = $1, comment = $3 WHERE id = $5',
      [5, null, 'test comment', JSON.stringify([]), '00000000-0000-0000-0000-000000000000']
    );
    console.log('result', result.rowCount);
  } catch (err) {
    console.error('error', err.message);
  } finally {
    process.exit();
  }
})();