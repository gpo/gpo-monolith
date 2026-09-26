import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * The cover letter that goes with a receipt (ticket 3.5, carried into 3.6).
 * The body text is caller-supplied: the rules authority owns the wording
 * (workflows.md W4) and there is no stored template yet, so nothing here
 * writes donor-facing prose beyond the name, address, and receipt number.
 *
 * Email puts the letter in the message body with the receipt PDF attached.
 * Mail puts a letter page in front of each receipt in the print batch, with
 * the address placed for a #10 window envelope.
 */

export interface LetterAddress {
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface CoverLetterData {
  contactName: string;
  receiptNumber: string;
  body: string;
  /** printed as the address block; omitted for email */
  address?: LetterAddress;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function addressLines(address: LetterAddress): string[] {
  return [
    address.line1,
    ...(address.line2 ? [address.line2] : []),
    `${address.city} ${address.province}  ${address.postalCode}`,
    ...(address.country && address.country !== 'CA' ? [address.country] : []),
  ];
}

/** Adds one US Letter cover-letter page to `pdfDoc`. */
export async function addCoverLetterPage(pdfDoc: PDFDocument, data: CoverLetterData): Promise<void> {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([612, 792]); // US Letter, points

  // Window position for a #10 envelope: roughly 2" from the top, 1" in.
  let y = 650;
  for (const line of [data.contactName, ...(data.address ? addressLines(data.address) : [])]) {
    page.drawText(line, { x: 72, y, size: 11, font });
    y -= 14;
  }

  y -= 28;
  page.drawText(`Re: Receipt ${data.receiptNumber}`, { x: 72, y, size: 11, font });
  y -= 28;

  const lines = data.body
    .split('\n')
    .flatMap((paragraph) => (paragraph.length === 0 ? [''] : wrapText(paragraph, 90)));
  for (const line of lines) {
    page.drawText(line, { x: 72, y, size: 10, font });
    y -= 14;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The email form of the letter: the same three parts as the printed page. */
export function renderCoverLetterEmail(data: CoverLetterData): { text: string; html: string } {
  const text = `${data.contactName}\n\nRe: Receipt ${data.receiptNumber}\n\n${data.body}\n`;
  const paragraphs = data.body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const html =
    `<p>${escapeHtml(data.contactName)}</p>\n` +
    `<p>Re: Receipt ${escapeHtml(data.receiptNumber)}</p>\n` +
    paragraphs;
  return { text, html };
}

/** A plain message with a link appended (the donor pre-check email). */
export function renderLinkEmail(data: { body: string; linkUrl: string }): { text: string; html: string } {
  const text = `${data.body}\n\n${data.linkUrl}\n`;
  const paragraphs = data.body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const html = `${paragraphs}\n<p><a href="${escapeHtml(data.linkUrl)}">${escapeHtml(data.linkUrl)}</a></p>`;
  return { text, html };
}
