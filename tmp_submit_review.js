require('dotenv').config();
const jwt = require('jsonwebtoken');
// Use global fetch available in Node 18+
const fetch = globalThis.fetch || require('node-fetch');

(async () => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) throw new Error('JWT_SECRET not set');

    const payload = {
      userId: 'user_3GgHSTRX3ulqHfCXZTu5QrOj027',
      email: 'test@example.com',
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    console.log('Using token:', token.slice(0, 20) + '...');

    const body = {
      orderItemId: 'a9fb4770-da63-46b8-b694-463e809cf521',
      productId: 'f29145a8-5d2f-4257-9389-e6ff68ad416b',
      rating: 5,
      review: 'This is an automated test review with image',
      review_images: ['https://res.cloudinary.com/demo/image/upload/v123456/test.jpg']
    };

    const resp = await fetch('http://localhost:5000/api/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    console.log('Status:', resp.status);
    console.log('Response body:', text);
  } catch (err) {
    console.error('Request error:', err);
  }
})();
