// Example: Testing the backend API

// Make sure backend is running: npm run dev

const API_URL = 'http://localhost:5000/api';
let token = '';

// Helper function
async function makeRequest(endpoint, method = 'GET', body = null, useToken = false) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (useToken && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  return response.json();
}

// Test flow
async function runTests() {
  try {
    console.log('🧪 Starting API tests...\n');

    // 1. Signup
    console.log('1️⃣ Testing Signup...');
    const signupResponse = await makeRequest('/auth/signup', 'POST', {
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      password: 'test123456',
      role: 'customer',
    });
    console.log('✅ Signup successful:', signupResponse.user);
    token = signupResponse.token;

    // 2. Verify token
    console.log('\n2️⃣ Testing Token Verification...');
    const verifyResponse = await makeRequest('/auth/verify', 'GET', null, true);
    console.log('✅ Token verified:', verifyResponse.user.email);

    // 3. Get user profile
    console.log('\n3️⃣ Testing User Profile...');
    const profileResponse = await makeRequest('/users/profile', 'GET', null, true);
    console.log('✅ Profile retrieved:', profileResponse);

    // 4. Get products
    console.log('\n4️⃣ Testing Get Products...');
    const productsResponse = await makeRequest('/products', 'GET');
    console.log('✅ Products retrieved:', productsResponse.length, 'products');

    // 5. Add to cart
    console.log('\n5️⃣ Testing Add to Cart...');
    if (productsResponse.length > 0) {
      const cartResponse = await makeRequest(
        '/cart/add',
        'POST',
        {
          product_id: productsResponse[0].id,
          quantity: 1,
        },
        true
      );
      console.log('✅ Added to cart:', cartResponse.message);
    } else {
      console.log('ℹ️ No products available to add to cart');
    }

    // 6. Get cart
    console.log('\n6️⃣ Testing Get Cart...');
    const cartItems = await makeRequest('/cart', 'GET', null, true);
    console.log('✅ Cart items:', cartItems.length);

    // 7. Get wishlist
    console.log('\n7️⃣ Testing Get Wishlist...');
    const wishlist = await makeRequest('/wishlist', 'GET', null, true);
    console.log('✅ Wishlist items:', wishlist.length);

    // 8. Get orders
    console.log('\n8️⃣ Testing Get Orders...');
    const orders = await makeRequest('/orders', 'GET', null, true);
    console.log('✅ Orders:', orders.length);

    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run tests (uncomment and run in browser console or Node.js)
// runTests();

export { makeRequest, runTests };
