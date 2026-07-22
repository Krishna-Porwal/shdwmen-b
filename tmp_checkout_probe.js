const jwt = require('jsonwebtoken');
const http = require('http');

const token = jwt.sign({ userId: 'test-user-checkout', email: 'checkout@example.com' }, 'shdwmen_jwt_secret_key_2024_production_change_this');
const body = JSON.stringify({
  items: [{ product_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
  shipping_address: {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    phone: '1234567890',
    address: '1 Test St',
    city: 'Test',
    state: 'TS',
    pinCode: '000000',
    paymentMethod: 'COD'
  }
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 5000,
  path: '/api/orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('status=' + res.statusCode);
    console.log(data);
  });
});
req.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
req.write(body);
req.end();
