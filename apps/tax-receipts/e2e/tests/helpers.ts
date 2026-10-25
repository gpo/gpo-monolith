import { expect, type Download, type Locator, type Page } from '@playwright/test';
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

/** Sign out by dropping the session, then sign in as another seeded user.
 *  The Admin Change log is shown only to roles that read everything or
 *  administer settings or users (not `admin@`), so a test that does its work
 *  as `admin@` switches to `sysadmin` to read the log. */
export async function switchUser(page: Page, user: SeededUser) {
  await page.context().clearCookies();
  await signIn(page, user);
}

/** Click a change-log row (in the Admin Change log explorer or a record's
 *  Change history table) and return the entry dialog that opens. The row
 *  itself shows only a one-line "Changes" summary; the Before and After
 *  values are in the dialog. */
export async function openChangeEntry(page: Page, row: Locator): Promise<Locator> {
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** One field's row in a change entry dialog, with cells Field, kind badge,
 *  Before, and After. Fields are dotted paths such as `addresses.0.city`.
 *  Unchanged fields are hidden until "Show N unchanged fields" is clicked. */
export function changeField(dialog: Locator, field: string): Locator {
  // `has` is matched inside each row, so it must be rooted at the page, not the dialog
  return dialog.getByRole('row').filter({ has: dialog.page().getByRole('cell', { name: field, exact: true }) });
}

/** Of several change-log rows, open the entry whose dialog has a row for
 *  `field` and return that dialog, closing the others. Issuing a receipt, for
 *  example, logs two creations with the same reason (the receipt, then its PDF),
 *  and only the receipt's has `receiptNumber`. */
export async function openChangeEntryWithField(page: Page, rows: Locator, field: string): Promise<Locator> {
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const dialog = await openChangeEntry(page, rows.nth(i));
    if ((await changeField(dialog, field).count()) > 0) return dialog;
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  }
  throw new Error(`no change entry with a "${field}" field among ${count} rows`);
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
