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
  /** where Artifact bytes (receipt PDFs, etc.) are written. A local-disk
   *  stand-in (ticket 3.1) — object storage is a later infra ticket; the
   *  Artifact.uri pointer stays storage-agnostic so that swap needs no
   *  schema change. */
  ARTIFACT_STORAGE_DIR: z.string().default('./storage/artifacts'),
  /** which email adapter sends (ticket 3.6): `dev` sends nothing and keeps
   *  the outbox rows as the record; `resend` needs RESEND_API_KEY and an
   *  EMAIL_FROM on a domain verified in Resend. */
  EMAIL_PROVIDER: z.enum(['dev', 'resend']).default('dev'),
  RESEND_API_KEY: z.string().optional(),
  /** `whsec_...` from the Resend webhook settings; without it the webhook
   *  route refuses every request */
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default('GPO Tax Receipts <receipts@localhost>'),
  EMAIL_REPLY_TO: z.string().optional(),
  /** sends per second; Resend's default team limit is 10 */
  EMAIL_RATE_PER_SECOND: z.coerce.number().positive().default(5),
  /** cap on sends in any rolling 24 hours, for warming up a new sending
   *  domain; unset means no cap */
  EMAIL_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
  EMAIL_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  /** the web app's public origin, for links in donor email */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
}).superRefine((env, ctx) => {
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when EMAIL_PROVIDER=resend' });
  }
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
