require('dotenv').config();
const { verifyToken } = require('@clerk/backend');

(async () => {
  const fakeToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE5MDAwMDAwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  try {
    const decoded = await verifyToken(fakeToken, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    console.log('Decoded:', decoded);
  } catch (err) {
    console.error('Verify failed as expected:', err && err.message ? err.message : err);
  }
})();
