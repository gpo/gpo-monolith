import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/**
 * The donor's "cancelled copy" (corrections.md action 1: "queues the donor
 * notice with the cancelled copy, watermarked CANCELLED") — the same
 * treatment workflows.md's "Current" process already does by hand in Adobe.
 * Stamps every page of the already-rendered receipt PDF; does not touch the
 * original artifact (invariant 7 freezes `Receipt.pdfArtifactId` once set —
 * PHASE-3-NOTES ticket 3.3's own deviation 3 flagged that a correction needs
 * its own place for a new PDF, not a rewrite of the original).
 *
 * This is the mechanism; the exact wording/placement the Evaluation Tool's
 * rows 59-63 expect is ticket 3.11's job, same relationship ticket 3.5's
 * plain cover letter has to whatever polish comes later.
 */
export async function renderCancellationNoticePdf(originalPdfBytes: Buffer): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const text = 'CANCELLED';
  const size = 64;
  const textWidth = font.widthOfTextAtSize(text, size);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2 - size / 2,
      size,
      font,
      color: rgb(0.75, 0, 0),
      opacity: 0.55,
      rotate: degrees(35),
    });
  }

  return Buffer.from(await pdfDoc.save());
}
