import { expect, type Download, type Page } from '@playwright/test';
import { PDFParse } from 'pdf-parse';

export const SEEDED_PASSWORD = 'change-me-please-12345';

export type SeededUser = 'sysadmin' | 'cfo' | 'admin' | 'rules' | 'books' | 'filer' | 'readonly';

/** Sign in as one of the users `prisma/seed.ts` creates. */
export async function signIn(page: Page, user: SeededUser, password = SEEDED_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${user}@gpo.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
}

/** The text of a downloaded PDF (a receipt or cancellation notice), for
 *  asserting what it prints; the browser tools cannot read inside a PDF. */
export async function pdfText(download: Download): Promise<string> {
  return pdfTextFromBuffer(await readAll(download));
}

/** The text of a PDF fetched directly, e.g. `(await page.request.get(href)).body()`
 *  for a "View PDF" or "Cancellation notice" link that opens in a new tab. */
export async function pdfTextFromBuffer(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

async function readAll(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
