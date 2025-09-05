import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createReadStream } from 'fs';
import csv from 'csv-parser';

const TEMPLATE_PDF_PATH = 'scripts/generate_tax_receipt_pdfs/template.pdf';
const CSV_PATH = 'scripts/generate_tax_receipt_pdfs/data.csv';
const OUTPUT_PDF_PATH = 'output.pdf';
const INDIVIDUAL_OUTPUT_DIR = 'individual_receipts';

// Ensure the individual receipts directory exists
if (!fs.existsSync(INDIVIDUAL_OUTPUT_DIR)) {
  fs.mkdirSync(INDIVIDUAL_OUTPUT_DIR, { recursive: true });
}

function generateFileName(row) {
  const year = new Date(row.Receipt_Issuance_Date).getFullYear().toString();
  const issueDate = row.Receipt_Issuance_Date.replace(/-/g, '');
  const receiptNumber = row.Receipt_Number;
  return `Receipt-${year}-${issueDate}-${receiptNumber}.pdf`;
}

function drawReceiptOnPage(page, font, row, width, height) {
  // Draw contributor ID
  const contributorIDWidth = font.widthOfTextAtSize(row.Contributor_ID, 8);
  page.drawText(row.Contributor_ID, {
    x: width - contributorIDWidth - 37,
    y: height - 20,
    size: 8,
  });

  // Draw the three receipt copies
  drawRow(0, page, row, width, height);
  drawRow(255, page, row, width, height);
  drawRow(510, page, row, width, height);
}

async function createReceiptPage(templatePdf, font, row) {
  const pdfDoc = await PDFDocument.create();
  const pageFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const [page] = await pdfDoc.copyPages(templatePdf, [0]);
  pdfDoc.addPage(page);
  const { width, height } = page.getSize();

  drawReceiptOnPage(page, pageFont, row, width, height);

  return { pdfDoc, page, width, height };
}

async function createPDF() {
  // Load the template PDF
  const templateBytes = fs.readFileSync(TEMPLATE_PDF_PATH);
  const templatePdf = await PDFDocument.load(templateBytes);

  // Create a new PDF document for the combined file
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Stream CSV line by line
  let count = 0;
  const stream = createReadStream(CSV_PATH).pipe(csv());

  for await (const row of stream) {
    // Copy template page for combined PDF
    const [newPage] = await pdfDoc.copyPages(templatePdf, [0]);
    pdfDoc.addPage(newPage);
    const { width, height } = newPage.getSize();

    drawReceiptOnPage(newPage, font, row, width, height);

    // Create individual PDF for this receipt
    const { pdfDoc: individualPdf } = await createReceiptPage(
      templatePdf,
      font,
      row,
    );

    // Save individual PDF
    const fileName = generateFileName(row);
    const filePath = path.join(INDIVIDUAL_OUTPUT_DIR, fileName);
    const individualPdfBytes = await individualPdf.save();
    fs.writeFileSync(filePath, individualPdfBytes);

    count++;

    if (count % 100 === 0) {
      console.log(`Processed ${count} receipts...`);
    }

    // Periodically save and clear memory for combined PDF
    if (count % 500 === 0) {
      console.log(`Saving intermediate progress at ${count} pages...`);
      fs.writeFileSync(OUTPUT_PDF_PATH, await pdfDoc.save());
    }
  }

  // Save final combined file
  console.log(`Saving final combined PDF with ${count} pages...`);
  fs.writeFileSync(OUTPUT_PDF_PATH, await pdfDoc.save());
  console.log(
    `Generated ${count} individual PDFs in ${INDIVIDUAL_OUTPUT_DIR} directory`,
  );
}

createPDF().catch(console.error);

function drawRow(position, newPage, row, width, height) {
  newPage.drawText(
    `Issue Date: ${row.Receipt_Issuance_Date}
Received on: ${row.Acceptance_Date}
Eligible Amount: $${row.Contribution_Amount}
Contribution Type: ${row.Contribution_Type === 'MO' ? 'Monetary' : 'Goods and Services'}
Received By: ${row.Political_Entity}`,
    {
      x: width - 250,
      y: height - 115 - position,
      size: 9,
      lineHeight: 18,
    },
  );
  newPage.drawText(
    `Receipt No: ${row.Receipt_Number}
Received from:
`,
    {
      x: 40,
      y: height - 110 - position,
      size: 9,
      lineHeight: 14,
    },
  );
  newPage.drawText(
    `${row.Contributor_First_Name} ${row.Contributor_Last_Name}
${row.Contributor_Address}
${row.Contributor_City} ${row.Contributor_Province} ${row.Contributor_Postal_Code.replace(' ', '')}
CANADA`.toUpperCase(),
    {
      x: 70,
      y: height - 150 - position,
      size: 9,
      lineHeight: 11,
    },
  );
}
