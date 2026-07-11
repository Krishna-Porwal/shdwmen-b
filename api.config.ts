// Backend API Configuration
// Use this file in your frontend to configure API endpoints

export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export const API_ENDPOINTS = {
  // Auth
  AUTH: {
    SIGNUP: '/auth/signup',
    LOGIN: '/auth/login',
    VERIFY: '/auth/verify',
  },

  // Products
  PRODUCTS: {
    LIST: '/products',
    GET: (id: string) => `/products/${id}`,
    CREATE: '/products',
    UPDATE: (id: string) => `/products/${id}`,
    DELETE: (id: string) => `/products/${id}`,
  },

  // Cart
  CART: {
    GET: '/cart',
    ADD: '/cart/add',
    UPDATE: (id: string) => `/cart/${id}`,
    DELETE: (id: string) => `/cart/${id}`,
    CLEAR: '/cart/clear',
  },

  // Orders
  ORDERS: {
    LIST: '/orders',
    GET: (id: string) => `/orders/${id}`,
    CREATE: '/orders',
    UPDATE_STATUS: (id: string) => `/orders/${id}/status`,
  },

  // Wishlist
  WISHLIST: {
    GET: '/wishlist',
    ADD: '/wishlist/add',
    DELETE: (id: string) => `/wishlist/${id}`,
    CHECK: (productId: string) => `/wishlist/check/${productId}`,
  },

  // Users
  USERS: {
    PROFILE: '/users/profile',
    UPDATE_PROFILE: '/users/profile',
    CHANGE_PASSWORD: '/users/change-password',
    GET: (id: string) => `/users/${id}`,
  },

  // Merchant
  MERCHANT: {
    DASHBOARD: '/merchant/dashboard',
    PRODUCTS: '/merchant/products',
    ORDERS: '/merchant/orders',
    ORDER_DETAILS: (id: string) => `/merchant/orders/${id}`,
    ANALYTICS: '/merchant/analytics/products',
    REVIEWS: '/merchant/reviews',
  },

  // Upload (NEW)
  UPLOAD: {
    IMAGE: '/upload/image',
    IMAGES: '/upload/images',
    DELETE: (publicId: string) => `/upload/${publicId}`,
  },
};

// API Helper function
export const apiCall = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET',
  data?: any,
  token?: string
) => {
  const headers: any = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
};

// Image upload helper function
export const uploadImage = async (file: File, token: string) => {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.UPLOAD.IMAGE}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Image upload failed');
  }

  return response.json();
};

// Multiple images upload helper
export const uploadMultipleImages = async (files: File[], token: string) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('images', file);
  });

  const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.UPLOAD.IMAGES}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Images upload failed');
  }

  return response.json();
};

// Delete image helper
export const deleteImage = async (publicId: string, token: string) => {
  const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.UPLOAD.DELETE(publicId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Image deletion failed');
  }

  return response.json();
};
