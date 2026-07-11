// Test merchant profile endpoint with existing Clerk token
import fetch from 'node-fetch';

const testToken = 'eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zRkhFNXFYeVI4QTM3WjdGd2oyQ0N3QmtqdVkiLCJvaWF0IjoxNzgxOTYzMDA5LCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJleHAiOjE3ODE5NjMwNjksImZ2YSI6Wzk3LC0xXSwiaWF0IjoxNzgxOTYzMDA5LCJpc3MiOiJodHRwczovL2lubm9jZW50LXBvbGVjYXQtNDYuY2xlcmsuYWNjb3VudHMuZGV2IiwibmJmIjoxNzgxOTYyOTk5LCJzaWQiOiJzZXNzXzNGT3J2ZjI5b2p6YVBxd0ZMd0hhN0pybDRJUSIsInN0cyI6ImFjdGl2ZSIsInN1YiI6InVzZXJfM0ZPcnZlN25EQU45VkQyMTF1SUo5RFJIQ3hEIiwidiI6Mn0.N_XTEi2fC68HmBEHmjP_XgUMgkvbIBjJSQa3JsOZnhogOaL0A9opaLUu25gBtn9JIk_5jXAIoR__EaPd6cidOhJakJFXNkWA82T4kDK5rO94SUBTiNEbhIJeS8ZsOHKMSp_XqzCnN9809TbnrlxEWbKxN9N7yf2iHyRgTWg5Bn2MRjF0cPL49X_0X1EY2E4hMHKB1hvmY3TzP3VOPU8Kea27oB_pRIBF_yz3ea7YxlDRfjsl-LYalDRba472WP-qH1Il-eHmT1uee7GLBbUUW1ZC8ryyjlENb-2PVMp5loFlZaIjW97NJ9CGphKqj459RFDu7VJSuv3x0aMQqXbIGg';

async function testMerchantProfile() {
  try {
    console.log('Testing merchant profile endpoint with email in body...');
    
    const response = await fetch('http://localhost:5000/api/merchant/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${testToken}`,
      },
      body: JSON.stringify({
        shopName: 'Test Shop',
        ownerName: 'Test Owner',
        phone: '+91-9999999999',
        address: '123 Main Street',
        email: 'testmerchant2@shdwmen.com',
      }),
    });

    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

testMerchantProfile();
