import 'dotenv/config';
import { z } from 'zod';
const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_PRESET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
  OPENWA_API_URL: z.string().url().optional(),
  OPENWA_API_KEY: z.string().min(16).optional(),
  OPENWA_WEBHOOK_SECRET: z.string().min(16).optional(),
  WORKER_POLL_MS: z.coerce.number().int().min(500).default(2000),
});
export function loadConfig() {
  const parsed = env.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  if (
    parsed.data.NODE_ENV === 'production' &&
    (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
  )
    throw new Error('Emulators are forbidden in production');
  if (!parsed.data.CORS_ORIGINS.split(',').some((origin) => origin.trim()))
    throw new Error('CORS_ORIGINS must contain at least one origin');
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*'))
      throw new Error('CORS_ORIGINS cannot contain * in production');
    const required = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      'GEMINI_API_KEY',
      'OPENWA_API_URL',
      'OPENWA_API_KEY',
      'OPENWA_WEBHOOK_SECRET',
    ] as const;
    const missing = required.filter((key) => !parsed.data[key]);
    if (missing.length) throw new Error(`Missing production environment: ${missing.join(', ')}`);
  }
  return parsed.data;
}
