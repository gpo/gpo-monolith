import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://gpo:gpo@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('lists every missing required variable in one error', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*SESSION_SECRET/);
  });

  it('applies development defaults', () => {
    const env = loadEnv(base);
    expect(env.PUBLIC_WEB_URL).toBe('http://localhost:5173');
    expect(env.EMAIL_FROM).toBe('GPO Tax Receipts <receipts@localhost>');
  });

  it('requires PUBLIC_WEB_URL in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/PUBLIC_WEB_URL: required when NODE_ENV=production/);
    expect(loadEnv({ ...base, NODE_ENV: 'production', PUBLIC_WEB_URL: 'https://example.org' }).PUBLIC_WEB_URL).toBe('https://example.org');
  });

  it('requires RESEND_API_KEY and EMAIL_FROM for the resend provider', () => {
    expect(() => loadEnv({ ...base, EMAIL_PROVIDER: 'resend', EMAIL_FROM: '' })).toThrow(/RESEND_API_KEY[\s\S]*EMAIL_FROM/);
  });
});
