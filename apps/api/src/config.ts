import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().default('postgresql://air:air_dev_password@localhost:5432/air?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('air-minio'),
  S3_SECRET_KEY: z.string().default('air_minio_secret'),
  S3_BUCKET_AUDIO: z.string().default('air-audio'),
  S3_BUCKET_ART: z.string().default('air-art'),
  S3_BUCKET_UPLOADS: z.string().default('air-uploads'),
  S3_PUBLIC_URL: z.string().default('http://localhost:9000'),

  MEILI_HOST: z.string().default('http://localhost:7700'),
  MEILI_MASTER_KEY: z.string().default('air_meili_master_key'),

  JWT_ACCESS_SECRET: z.string().default('dev_access_secret_change_me'),
  JWT_REFRESH_SECRET: z.string().default('dev_refresh_secret_change_me'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_DOMAIN: z.string().optional(),
  SIGNED_URL_TTL: z.coerce.number().default(900),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
