import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Environment variable ${name} is required.`);
  }
  return value;
};

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = process.env.PORT || '5000';
export const CORS_ORIGIN = requiredEnv('CORS_ORIGIN');
export const JWT_SECRET = requiredEnv('JWT_SECRET');
export const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || '';
export const CLERK_API_URL = process.env.CLERK_API_URL || 'https://api.clerk.dev';
export const DATABASE_URL = requiredEnv('DATABASE_URL');
export const CLOUDINARY_CLOUD_NAME = requiredEnv('CLOUDINARY_CLOUD_NAME');
export const CLOUDINARY_API_KEY = requiredEnv('CLOUDINARY_API_KEY');
export const CLOUDINARY_API_SECRET = requiredEnv('CLOUDINARY_API_SECRET');
export const RAZORPAY_KEY_ID = requiredEnv('RAZORPAY_KEY_ID');
export const RAZORPAY_KEY_SECRET = requiredEnv('RAZORPAY_KEY_SECRET');
export const BACKEND_SECRET = requiredEnv('BACKEND_SECRET');
