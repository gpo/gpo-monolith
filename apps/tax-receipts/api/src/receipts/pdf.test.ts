import { PDFParse } from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderReceiptPdf, type ReceiptPdfData } from './pdf.js';

/**
 * PDF rendering + text-extraction tests (ticket 3.4, test-plan F4). F4 asks
 * for two things: (1) render a sample and extract text fields back out --
 * number, dates, amount, name, address, entity, the official-receipt
 * statement -- and (2) compare those against real, EO-issued 2025 receipt
 * PDFs. Only (1) is buildable here: the real 2025 receipt PDFs are private,
 * PII-bearing Drive downloads with no fetch access from this build
 * environment (research/fixtures/README.md) -- the same class of gap 4.1/
 * 4.2's F1 byte-diff residual and O43 already flagged for other artifacts.
 * This file is a self-consistency check instead: given known input data,
 * does the rendered PDF's *extracted text* actually contain what was asked
 * for, on all three of the template's stamped copies, not just "did a
 * one-page PDF come out" (issue.test.ts's existing page-count check).
 */

const BASE_DATA: ReceiptPdfData = {
  receiptNumber: 'GPO-00402510',
  issueDate: new Date('2026-03-15T00:00:00Z'),
  acceptedAt: new Date('2026-03-01T00:00:00Z'),
  eligibleAmountCents: 12_345,
  isGoodsServices: false,
  politicalEntityLabel: 'Green Party of Ontario',
  eoContributorId: null,
  contributorName: 'Dana Donor',
  addressLine1: '1 Main St',
  addressLine2: null,
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M1M 1M1',
  country: 'CA',
};

async function extractText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

describe('renderReceiptPdf text extraction (ticket 3.4, F4)', () => {
  it('renders a one-page PDF (three stamped copies) matching the legacy triplicate layout', async () => {
    const bytes = await renderReceiptPdf(BASE_DATA);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("carries the template's statutory statement onto the rendered receipt, once per copy", async () => {
    const bytes = await renderReceiptPdf(BASE_DATA);
    const text = await extractText(bytes);

    const statement = 'This is your Official Receipt for income tax purposes.';
    const occurrences = text.split(statement).length - 1;
    expect(occurrences).toBe(3);
    expect(text).toContain('Green Party of Ontario'); // the template's own letterhead
  });

  it('extracts every F4 field: number, dates, amount, name, address, entity', async () => {
    const bytes = await renderReceiptPdf(BASE_DATA);
    const text = await extractText(bytes);

    expect(text).toContain('GPO-00402510');
    expect(text).toContain('2026-03-15'); // issue date
    expect(text).toContain('2026-03-01'); // accepted (received on) date
    expect(text).toContain('$123.45'); // eligible amount
    expect(text).toContain('Monetary'); // contribution type
    expect(text).toContain('Green Party of Ontario'); // received by / political entity label
    expect(text).toContain('DANA DONOR'); // contributor name (address block is upper-cased)
    expect(text).toContain('1 MAIN ST');
    expect(text).toContain('TORONTO ON M1M1M1');
    expect(text).toContain('CA');

    // every dynamic field appears once per stamped copy (three copies per page).
    expect(text.split('GPO-00402510').length - 1).toBe(3);
    expect(text.split('$123.45').length - 1).toBe(3);
  });

  it('renders the goods-and-services contribution type when flagged', async () => {
    const bytes = await renderReceiptPdf({ ...BASE_DATA, isGoodsServices: true });
    const text = await extractText(bytes);
    expect(text).toContain('Goods and Services');
    expect(text).not.toContain('Contribution Type: Monetary');
  });

  it('prints the EO contributor id near the top of the page when present, omits it otherwise', async () => {
    const withId = await extractText(await renderReceiptPdf({ ...BASE_DATA, eoContributorId: 'EO-12345' }));
    expect(withId).toContain('EO-12345');

    const withoutId = await extractText(await renderReceiptPdf({ ...BASE_DATA, eoContributorId: null }));
    expect(withoutId).not.toContain('EO-12345');
  });

  it('joins a second address line and formats the postal code without its internal space', async () => {
    const text = await extractText(
      await renderReceiptPdf({
        ...BASE_DATA,
        addressLine1: '100 Queen St W',
        addressLine2: 'Unit 4',
        postalCode: 'M5H 2N2',
      }),
    );
    expect(text).toContain('100 QUEEN ST W, UNIT 4');
    expect(text).toContain('TORONTO ON M5H2N2');
  });

  it('prints "This cancels and replaces receipt #n" on every copy of a replacement receipt (corrections.md principle 4)', async () => {
    const text = await extractText(await renderReceiptPdf({ ...BASE_DATA, replacesReceiptNumber: 'GPO-00402400' }));
    expect(text.split('This cancels and replaces receipt #GPO-00402400').length - 1).toBe(3);
    expect(await extractText(await renderReceiptPdf(BASE_DATA))).not.toContain('cancels and replaces');
  });

  it('stamps every copy COPY for a lost-receipt reprint', async () => {
    const text = await extractText(await renderReceiptPdf({ ...BASE_DATA, isCopy: true }));
    expect(text.split('COPY').length - 1).toBe(3);
  });
});
