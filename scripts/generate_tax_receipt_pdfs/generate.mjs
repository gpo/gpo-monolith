import fs from 'fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createReadStream } from 'fs';
import csv from 'csv-parser';

const TEMPLATE_PDF_PATH = 'scripts/generate_tax_receipt_pdfs/template.pdf';
const CSV_PATH = 'scripts/generate_tax_receipt_pdfs/data.csv';
const OUTPUT_PDF_PATH = 'output.pdf';

async function createPDF() {
  // Load the template PDF
  const templateBytes = fs.readFileSync(TEMPLATE_PDF_PATH);
  const templatePdf = await PDFDocument.load(templateBytes);
  const templatePage = templatePdf.getPages()[0]; // Assuming a single-page template

  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Stream CSV line by line
  let count = 0;
  const stream = createReadStream(CSV_PATH).pipe(csv());

  for await (const row of stream) {
    // Copy template page
    const [newPage] = await pdfDoc.copyPages(templatePdf, [0]);
    pdfDoc.addPage(newPage);
    const { width, height } = newPage.getSize();


    const contributorIDWidth = font.widthOfTextAtSize(row.Contributor_ID, 8);
    newPage.drawText(row.Contributor_ID, {
      x: width - contributorIDWidth - 37,
      y: height - 20,
      size: 8,
    });

    drawRow(0, newPage, row, width, height);
    drawRow(255, newPage, row, width, height);
    drawRow(510, newPage, row, width, height);

    count++;

    // Periodically save and clear memory
    if (count % 500 === 0) {
      console.log(`Saving intermediate progress at ${count} pages...`);
      fs.writeFileSync(OUTPUT_PDF_PATH, await pdfDoc.save());
    }
  }

  // Save final file
  console.log(`Saving final PDF with ${count} pages...`);
  fs.writeFileSync(OUTPUT_PDF_PATH, await pdfDoc.save());
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
        }
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
        }
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
        }
    );
}
