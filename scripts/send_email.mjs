import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const SERVICE_ACCOUNT_EMAIL =
  'gpo-app@terraform-staging-448916.iam.gserviceaccount.com';

// Path to your service account JSON key file
const SERVICE_ACCOUNT_FILE = path.join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'terraform-staging-448916-5652c3e3622d.json',
);
console.error(`Service account file: ${SERVICE_ACCOUNT_FILE}`);

// Check if the service account file exists
if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
  console.error('Service account file does not exist');
  process.exit(1);
}

// Authenticate with the service account
const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'], // Read-only scope for Google Drive
});

// Initialize the Google Drive API client
const drive = google.drive({ version: 'v3', auth });

async function listFolders() {
  try {
    const response = await drive.files.list({
      q: `'${SERVICE_ACCOUNT_EMAIL}' in owners or '${SERVICE_ACCOUNT_EMAIL}' in readers or '${SERVICE_ACCOUNT_EMAIL}' in writers`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id, name)',
    });
    console.log('has access to:', response.data.files);
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}

async function getFolderName(folderId) {
  try {
    // Retrieve metadata of the folder
const response = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'id, name',
});
    console.log(`Folder ID: ${response.data.id}`);
    console.log(`Folder Name: ${response.data.name}`);
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}

async function listFolderContents(folderId) {
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`, // Query for files in the folder
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id, name, mimeType)', // Specify the fields you need
    });

    const files = response.data.files;
    if (files.length) {
      console.log(`Files in folder (ID: ${folderId}):`);
      files.forEach((file) => {
        console.log(`- ${file.name} (${file.id}, type: ${file.mimeType})`);
      });
    } else {
      console.log('The folder is empty.');
    }
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}

async function main() {
  await listFolders();

  const folderId = '1rNQFtVRQ8hT67H524HSvpCIe6YRYkGll';
  await getFolderName(folderId);
  listFolderContents(folderId);

  const folderId2 = '1zqw39dwX5-UZbRXlMzzpkggorkULrbAf';
  await getFolderName(folderId2);
  listFolderContents(folderId2);
}

main();
