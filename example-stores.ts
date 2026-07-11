import { create } from 'zustand';
import { apiCall, API_ENDPOINTS } from '@/lib/api.config';

// Example: Auth Store using Zustand
export const useAuthStore = create((set, get) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  user: null,
  isLoading: false,
  error: null,

  // Login user
  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall(API_ENDPOINTS.AUTH.LOGIN, 'POST', {
        email,
        password,
      });
      localStorage.setItem('token', response.token);
      set({ token: response.token, user: response.user, isLoading: false });
      return response;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  // Signup user
  signup: async (
    name: string,
    email: string,
    password: string,
    role: string = 'customer'
  ) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiCall(API_ENDPOINTS.AUTH.SIGNUP, 'POST', {
        name,
        email,
        password,
        role,
      });
      localStorage.setItem('token', response.token);
      set({ token: response.token, user: response.user, isLoading: false });
      return response;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  // Logout user
  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },

  // Verify token on app load
  verifyToken: async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await apiCall(
        API_ENDPOINTS.AUTH.VERIFY,
        'GET',
        undefined,
        token
      );
      set({ token, user: response.user });
    } catch (error) {
      localStorage.removeItem('token');
      set({ token: null, user: null });
    }
  },

  // Get token
  getToken: () => {
    return get().token;
  },

  // Check if authenticated
  isAuthenticated: () => {
    return !!get().token;
  },
}));

// Example: Products Store
export const useProductStore = create((set) => ({
  products: [],
  isLoading: false,
  error: null,

  // Get all products
  fetchProducts: async (category?: string, search?: string) => {
    set({ isLoading: true, error: null });
    try {
      let endpoint = API_ENDPOINTS.PRODUCTS.LIST;
      if (category || search) {
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (search) params.append('search', search);
        endpoint += `?${params.toString()}`;
      }
      const products = await apiCall(endpoint);
      set({ products, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  // Get single product
  getProduct: async (id: string) => {
    try {
      return await apiCall(API_ENDPOINTS.PRODUCTS.GET(id));
    } catch (error) {
      console.error('Error fetching product:', error);
    }
  },
}));

// Example: Cart Store
export const useCartStore = create((set, get) => ({
  items: [],
  isLoading: false,
  error: null,
  token: null,

  setToken: (token: string) => set({ token }),

  // Fetch cart items
  fetchCart: async () => {
    const token = get().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const items = await apiCall(API_ENDPOINTS.CART.GET, 'GET', undefined, token);
      set({ items, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  // Add to cart
  addToCart: async (productId: string, quantity: number) => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');

    try {
      await apiCall(
        API_ENDPOINTS.CART.ADD,
        'POST',
        { product_id: productId, quantity },
        token
      );
      await get().fetchCart();
    } catch (error) {
      console.error('Error adding to cart:', error);
      throw error;
    }
  },

  // Remove from cart
  removeFromCart: async (cartItemId: string) => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');

    try {
      await apiCall(
        API_ENDPOINTS.CART.DELETE(cartItemId),
        'DELETE',
        undefined,
        token
      );
      await get().fetchCart();
    } catch (error) {
      console.error('Error removing from cart:', error);
      throw error;
    }
  },

  // Clear cart
  clearCart: async () => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');

    try {
      await apiCall(API_ENDPOINTS.CART.CLEAR, 'POST', undefined, token);
      set({ items: [] });
    } catch (error) {
      console.error('Error clearing cart:', error);
      throw error;
    }
  },

  // Get total
  getTotal: () => {
    return get().items.reduce((sum, item) => sum + (item.total || 0), 0);
  },
}));
