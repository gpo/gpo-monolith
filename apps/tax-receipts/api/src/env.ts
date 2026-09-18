import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** trust the X-Forwarded-* headers (behind the GCP load balancer). */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** unset in most environments until B5/B6 land; the mirror-sweep trigger
   *  route (ticket 1.1) registers only when this is present. */
  QOMON_API_KEY: z.string().optional(),
  QOMON_API_BASE: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
