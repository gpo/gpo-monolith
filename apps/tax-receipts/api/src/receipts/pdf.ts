import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ReceiptLayout } from '../generated/prisma/index.js';

/**
 * Individual receipt PDF rendering (ticket 3.1). Draws onto the same
 * triplicate template used by the legacy batch tool
 * (`scripts/generate_tax_receipt_pdfs/generate.mjs`, copied into
 * `assets/receipt-template.pdf`) so a tool-issued receipt is laid out
 * identically to receipts already on file with EO: the template page has
 * three stamped copies (office / donor / political-entity), each filled with
 * the same fields.
 *
 * `politicalEntityLabel` is passed in rather than derived here: the exact
 * wording EO expects for a CA/campaign/party entity is a compliance.md
 * question (private repo), not something to guess at on a legal receipt.
 */

export interface ReceiptPdfData {
  receiptNumber: string;
  issueDate: Date;
  /** the acceptance date, or the first one on a combined receipt */
  acceptedAt: Date;
  /** the last acceptance date on a combined receipt (`combined.ts`); a
   *  later day than `acceptedAt` prints as a range */
  acceptedThrough?: Date | null;
  eligibleAmountCents: number;
  isGoodsServices: boolean;
  politicalEntityLabel: string;
  eoContributorId: string | null;
  contributorName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  /** set on a receipt that replaces a cancelled one; printed on every copy
   *  (corrections.md principle 4). */
  replacesReceiptNumber?: string | null;
  /** stamps every copy "COPY" for a lost-receipt reprint (status L). */
  isCopy?: boolean;
  /** which receipt layout to draw (ReceiptSettings); the caller reads the
   *  setting so every render path agrees */
  layout: ReceiptLayout;
}


const TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'receipt-template.pdf',
);

let templateBytesPromise: Promise<Buffer> | undefined;

function loadTemplateBytes(): Promise<Buffer> {
  templateBytesPromise ??= readFile(TEMPLATE_PATH);
  return templateBytesPromise;
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2026-03-01", or "2026-03-01 to 2026-05-02" for a combined receipt whose
 *  contributions were accepted on different days. */
function formatReceivedOn(data: ReceiptPdfData): string {
  const from = formatIsoDate(data.acceptedAt);
  const through = data.acceptedThrough ? formatIsoDate(data.acceptedThrough) : from;
  return through === from ? from : `${from} to ${through}`;
}

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function drawRow(position: number, page: PDFPage, font: PDFFont, data: ReceiptPdfData, width: number, height: number): void {
  page.drawText(
    `Issue Date: ${formatIsoDate(data.issueDate)}\n` +
      `Received on: ${formatReceivedOn(data)}\n` +
      `Eligible Amount: $${formatDollars(data.eligibleAmountCents)}\n` +
      `Contribution Type: ${data.isGoodsServices ? 'Goods and Services' : 'Monetary'}\n` +
      `Received By: ${data.politicalEntityLabel}`,
    { x: width - 250, y: height - 115 - position, size: 9, lineHeight: 18, font },
  );
  page.drawText(`Receipt No: ${data.receiptNumber}\nReceived from:\n`, {
    x: 40,
    y: height - 110 - position,
    size: 9,
    lineHeight: 14,
    font,
  });
  const addressLines = [
    data.contributorName,
    [data.addressLine1, data.addressLine2].filter(Boolean).join(', '),
    `${data.city} ${data.province} ${data.postalCode.replace(' ', '')}`,
    data.country,
  ];
  page.drawText(addressLines.join('\n').toUpperCase(), {
    x: 70,
    y: height - 150 - position,
    size: 9,
    lineHeight: 11,
    font,
  });
  if (data.replacesReceiptNumber) {
    page.drawText(`This cancels and replaces receipt #${data.replacesReceiptNumber}`, {
      x: 40,
      y: height - 215 - position,
      size: 8,
      font,
    });
  }
  if (data.isCopy) {
    page.drawText('COPY', { x: width / 2 - 20, y: height - 215 - position, size: 14, font });
  }
}

/** Ontario accepts contributions from individuals only, so `ContributorType`
 *  has the one value (EO evaluation row 56). */
const CONTRIBUTOR_TYPE_LABEL = 'Individual';

/** The `CONTRIBUTOR_TYPE` layout: `drawRow` with a sixth line in the
 *  right-hand column. Six lines at 15pt fill the band five fill at 18pt,
 *  clear of the template's signature image. Kept separate from `drawRow` so
 *  the legacy layout stays exactly as it was. */
function drawRowWithContributorType(
  position: number,
  page: PDFPage,
  font: PDFFont,
  data: ReceiptPdfData,
  width: number,
  height: number,
): void {
  page.drawText(
    `Issue Date: ${formatIsoDate(data.issueDate)}\n` +
      `Received on: ${formatReceivedOn(data)}\n` +
      `Eligible Amount: $${formatDollars(data.eligibleAmountCents)}\n` +
      `Contributor Type: ${CONTRIBUTOR_TYPE_LABEL}\n` +
      `Contribution Type: ${data.isGoodsServices ? 'Goods and Services' : 'Monetary'}\n` +
      `Received By: ${data.politicalEntityLabel}`,
    { x: width - 250, y: height - 115 - position, size: 9, lineHeight: 15, font },
  );
  page.drawText(`Receipt No: ${data.receiptNumber}\nReceived from:\n`, {
    x: 40,
    y: height - 110 - position,
    size: 9,
    lineHeight: 14,
    font,
  });
  const addressLines = [
    data.contributorName,
    [data.addressLine1, data.addressLine2].filter(Boolean).join(', '),
    `${data.city} ${data.province} ${data.postalCode.replace(' ', '')}`,
    data.country,
  ];
  page.drawText(addressLines.join('\n').toUpperCase(), {
    x: 70,
    y: height - 150 - position,
    size: 9,
    lineHeight: 11,
    font,
  });
  if (data.replacesReceiptNumber) {
    page.drawText(`This cancels and replaces receipt #${data.replacesReceiptNumber}`, {
      x: 40,
      y: height - 215 - position,
      size: 8,
      font,
    });
  }
  if (data.isCopy) {
    page.drawText('COPY', { x: width / 2 - 20, y: height - 215 - position, size: 14, font });
  }
}

const ROW_RENDERERS: Record<ReceiptLayout, typeof drawRow> = {
  LEGACY: drawRow,
  CONTRIBUTOR_TYPE: drawRowWithContributorType,
};

/** Render one issued receipt as a single-page PDF (the template's three
 *  stamped copies), returning the file bytes. */
export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const templateBytes = await loadTemplateBytes();
  const templatePdf = await PDFDocument.load(templateBytes);
  const templatePage = templatePdf.getPage(0);
  const { width, height } = templatePage.getSize();

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const [copiedPage] = await pdfDoc.copyPages(templatePdf, [0]);
  if (!copiedPage) throw new Error('receipt template has no pages to copy');
  pdfDoc.addPage(copiedPage);

  if (data.eoContributorId) {
    const idWidth = font.widthOfTextAtSize(data.eoContributorId, 8);
    copiedPage.drawText(data.eoContributorId, {
      x: width - idWidth - 37,
      y: height - 20,
      size: 8,
      font,
    });
  }

  const drawLayoutRow = ROW_RENDERERS[data.layout];
  for (const position of [0, 255, 510]) {
    drawLayoutRow(position, copiedPage, font, data, width, height);
  }

  return Buffer.from(await pdfDoc.save());
}
