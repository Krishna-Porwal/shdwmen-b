import 'dotenv/config';
import util from 'util';
import { ensureUserExists } from './src/middleware/auth';

(async () => {
  try {
    await ensureUserExists('user_3GgHSTRX3ulqHfCXZTu5QrOj027', 'test@example.com', 'Test User');
    console.log('ok');
  } catch (err:any) {
    try {
      console.error('err-full', util.inspect(err, { showHidden: true, depth: null }));
    } catch (e) {
      console.error('err', err);
    }
  } finally {
    process.exit(0);
  }
})();
