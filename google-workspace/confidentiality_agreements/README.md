# Confidentiality Agreement Email Processor

This Google Apps Script automatically processes emails containing confidentiality agreement signatures, extracts PDF attachments, saves them to Google Drive, and logs the details to a Google Sheet.

## Features

- **Automatic Email Monitoring**: Searches for emails with the pattern "has successfully signed the document Confidentiality Agreement"
- **PDF Extraction**: Automatically extracts PDF attachments from matching emails
- **Smart File Naming**: Saves PDFs with timestamp and person's name for easy identification
- **Google Sheet Logging**: Tracks all processed agreements with date, person name, and file links
- **Duplicate Prevention**: Uses timestamps to avoid processing the same emails multiple times
- **Error Handling**: Includes comprehensive error handling and optional email notifications

## Setup Instructions

### 1. Create Google Apps Script Project

1. Go to [Google Apps Script](https://script.google.com/)
2. Click "New Project"
3. Delete the default `Code.gs` content
4. Copy and paste the contents of `confidentiality-agreement-processor.gs` into the editor
5. Save the project with a descriptive name like "Confidentiality Agreement Processor"

### 2. Create Google Drive Folder

1. Go to [Google Drive](https://drive.google.com/)
2. Create a new folder for storing the PDF attachments (e.g., "Confidentiality Agreements")
3. Right-click the folder and select "Get link"
4. Copy the folder ID from the URL (the long string after `/folders/`)

### 3. Create Google Sheet for Logging

1. Create a new Google Sheet (e.g., "Confidentiality Agreement Log")
2. Copy the sheet ID from the URL (the long string between `/d/` and `/edit`)

### 4. Configure the Script

In the Google Apps Script editor, update the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
  // Replace with your Google Drive folder ID
  DRIVE_FOLDER_ID: 'your_actual_folder_id_here',
  
  // Replace with your Google Sheet ID
  SHEET_ID: 'your_actual_sheet_id_here',
  
  // Leave these as-is unless you want to customize
  SHEET_TAB_NAME: 'Confidentiality Agreements',
  GMAIL_SEARCH_QUERY: 'subject:"has successfully signed the document Confidentiality Agreement"',
  LAST_PROCESSED_PROPERTY: 'LAST_PROCESSED_TIMESTAMP'
};
```

### 5. Set Up Permissions

1. In the Apps Script editor, click "Run" on the `testProcessing` function
2. You'll be prompted to authorize the script - click "Review permissions"
3. Choose your Google account and click "Allow"
4. The script needs access to Gmail, Google Drive, and Google Sheets

### 6. Test the Script

1. Run the `testProcessing` function manually to test with recent emails
2. Check the execution log to see if it found and processed any emails
3. Verify that PDFs are saved to your Drive folder and logged in your Sheet

### 7. Set Up Automatic Trigger

1. Run the `setupTrigger` function once to create a time-driven trigger
2. This will set the script to run every 5 minutes automatically
3. You can view/manage triggers in the Apps Script editor under "Triggers" in the left sidebar

## How It Works

### Email Processing Flow

1. **Search**: Finds emails with subjects containing "has successfully signed the document Confidentiality Agreement"
2. **Parse**: Extracts the person's name from the email subject
3. **Extract**: Gets PDF attachments from the email
4. **Save**: Saves PDFs to Google Drive with descriptive filenames
5. **Log**: Records details in Google Sheet for tracking
6. **Track**: Updates timestamp to avoid reprocessing

### File Naming Convention

PDFs are saved with the format: `YYYY-MM-DD_HH-MM-SS_PersonName_OriginalFilename.pdf`

Example: `2024-01-15_14-30-25_Ian Edington_Confidentiality Agreement.pdf`

### Google Sheet Columns

The script creates a sheet with these columns:
- **Email Date**: When the original email was sent
- **Person Name**: Extracted from the email subject
- **Email Subject**: Full subject line of the email
- **File Count**: Number of PDFs saved
- **File Names**: Names of saved PDF files
- **File URLs**: Direct links to files in Google Drive
- **Processed At**: When the script processed this email

## Customization Options

### Change Trigger Frequency

You can modify how often the script runs by editing the `setupTrigger` function:

```javascript
// Run every minute (more responsive)
.everyMinutes(1)

// Run every 10 minutes (less frequent)
.everyMinutes(10)

// Run hourly
.everyHours(1)
```

### Modify Email Search Pattern

Update the `GMAIL_SEARCH_QUERY` in the CONFIG to change what emails are processed:

```javascript
// More specific search
GMAIL_SEARCH_QUERY: 'subject:"Ian Edington has successfully signed the document Confidentiality Agreement"',

// Include additional criteria
GMAIL_SEARCH_QUERY: 'subject:"has successfully signed the document Confidentiality Agreement" has:attachment',
```

### Custom File Naming

Modify the `saveAttachmentToDrive` function to change how files are named.

## Troubleshooting

### Common Issues

1. **Script not finding emails**: Check that the Gmail search query matches your email format
2. **Permission errors**: Re-run the authorization process
3. **Files not saving**: Verify the Drive folder ID is correct
4. **Sheet not updating**: Check the Sheet ID and tab name

### Viewing Logs

1. In Apps Script editor, go to "Executions" to see run history
2. Click on any execution to see detailed logs
3. Use `console.log()` statements for debugging

### Manual Functions

- `testProcessing()`: Test the script manually with recent emails
- `resetLastProcessedTimestamp()`: Reset to reprocess older emails
- `setupTrigger()`: Create/recreate the automatic trigger

## Security Considerations

- The script only accesses emails, Drive, and Sheets within your account
- All processing happens within Google's infrastructure
- Consider limiting Drive folder permissions if shared with others
- Review the script permissions during authorization

## Support

If you encounter issues:
1. Check the execution logs in Apps Script
2. Verify all IDs are correctly configured
3. Test individual functions manually
4. Check Gmail search syntax if emails aren't being found

The script includes error handling and will send you an email if critical errors occur during automated runs. 