/**
 * Google Apps Script to process confidentiality agreement emails
 * 
 * This script:
 * 1. Searches for emails with confidentiality agreement signatures
 * 2. Extracts PDF attachments and saves them to a Google Drive folder
 * 3. Logs details to a Google Sheet for tracking
 * 4. Uses timestamps to avoid processing the same emails twice
 */

// Configuration - Update these IDs with your actual folder and sheet IDs
const CONFIG = {
  // Replace with your Google Drive folder ID where PDFs should be saved
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID_HERE',
  
  // Replace with your Google Sheet ID for logging
  SHEET_ID: 'YOUR_SHEET_ID_HERE',
  
  // Name of the sheet tab (will be created if it doesn't exist)
  SHEET_TAB_NAME: 'Confidentiality Agreements',
  
  // Gmail search query to find confidentiality agreement emails
  GMAIL_SEARCH_QUERY: 'subject:"has successfully signed the document Confidentiality Agreement"',
  
  // Property key for storing last processed timestamp
  LAST_PROCESSED_PROPERTY: 'LAST_PROCESSED_TIMESTAMP'
};

/**
 * Main function to process confidentiality agreement emails
 * This should be called by a time-driven trigger
 */
function processConfidentialityAgreements() {
  try {
    console.log('Starting confidentiality agreement processing...');
    
    // Get the last processed timestamp
    const lastProcessed = getLastProcessedTimestamp();
    console.log(`Last processed timestamp: ${lastProcessed}`);
    
    // Search for emails since the last processed time
    const searchQuery = buildSearchQuery(lastProcessed);
    console.log(`Gmail search query: ${searchQuery}`);
    
    const threads = GmailApp.search(searchQuery, 0, 50); // Limit to 50 threads
    console.log(`Found ${threads.length} email threads to process`);
    
    if (threads.length === 0) {
      console.log('No new emails to process');
      return;
    }
    
    // Get the Drive folder and Sheet
    const driveFolder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const sheet = getOrCreateSheet();
    
    let latestTimestamp = lastProcessed;
    let processedCount = 0;
    
    // Process each thread
    for (const thread of threads) {
      const messages = thread.getMessages();
      
      for (const message of messages) {
        const messageDate = message.getDate();
        
        // Only process messages newer than our last processed timestamp
        if (messageDate.getTime() > lastProcessed) {
          if (processMessage(message, driveFolder, sheet)) {
            processedCount++;
            
            // Update the latest timestamp
            if (messageDate.getTime() > latestTimestamp) {
              latestTimestamp = messageDate.getTime();
            }
          }
        }
      }
    }
    
    // Update the last processed timestamp
    if (latestTimestamp > lastProcessed) {
      setLastProcessedTimestamp(latestTimestamp);
      console.log(`Updated last processed timestamp to: ${new Date(latestTimestamp)}`);
    }
    
    console.log(`Processing complete. Processed ${processedCount} emails.`);
    
  } catch (error) {
    console.error('Error processing confidentiality agreements:', error);
    
    // Send email notification about the error (optional)
    try {
      GmailApp.sendEmail(
        Session.getActiveUser().getEmail(),
        'Error in Confidentiality Agreement Processor',
        `An error occurred while processing confidentiality agreements:\n\n${error.toString()}\n\nStack trace:\n${error.stack}`
      );
    } catch (emailError) {
      console.error('Failed to send error notification email:', emailError);
    }
  }
}

/**
 * Process a single email message
 */
function processMessage(message, driveFolder, sheet) {
  try {
    const subject = message.getSubject();
    const messageDate = message.getDate();
    
    console.log(`Processing email: ${subject}`);
    
    // Extract person's name from subject
    // Expected format: "Ian Edington has successfully signed the document Confidentiality Agreement - Ian Edington"
    const personName = extractPersonName(subject);
    if (!personName) {
      console.log(`Could not extract person name from subject: ${subject}`);
      return false;
    }
    
    console.log(`Extracted person name: ${personName}`);
    
    // Get attachments
    const attachments = message.getAttachments();
    console.log(`Found ${attachments.length} attachments`);
    
    if (attachments.length === 0) {
      console.log('No attachments found, skipping');
      return false;
    }
    
    // Process each attachment
    const savedFiles = [];
    for (const attachment of attachments) {
      const contentType = attachment.getContentType();
      
      // Only process PDF attachments
      if (contentType === 'application/pdf') {
        const savedFile = saveAttachmentToDrive(attachment, personName, messageDate, driveFolder);
        if (savedFile) {
          savedFiles.push(savedFile);
        }
      } else {
        console.log(`Skipping non-PDF attachment: ${attachment.getName()} (${contentType})`);
      }
    }
    
    if (savedFiles.length > 0) {
      // Log to Google Sheet
      logToSheet(sheet, personName, messageDate, savedFiles, subject);
      console.log(`Successfully processed email for ${personName} with ${savedFiles.length} PDF(s)`);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error(`Error processing message: ${error}`);
    return false;
  }
}

/**
 * Extract person's name from the email subject
 */
function extractPersonName(subject) {
  // Pattern: "NAME has successfully signed the document Confidentiality Agreement - NAME"
  const match = subject.match(/^(.+?)\s+has successfully signed the document/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

/**
 * Save an attachment to Google Drive
 */
function saveAttachmentToDrive(attachment, personName, emailDate, driveFolder) {
  try {
    // Create a filename with timestamp and person name
    const timestamp = Utilities.formatDate(emailDate, Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
    const originalName = attachment.getName();
    const extension = originalName.includes('.') ? originalName.split('.').pop() : 'pdf';
    const newFileName = `${timestamp}_${personName}_${originalName}`;
    
    console.log(`Saving attachment as: ${newFileName}`);
    
    // Save the file to Drive
    const blob = attachment.copyBlob();
    blob.setName(newFileName);
    const file = driveFolder.createFile(blob);
    
    console.log(`Successfully saved file: ${file.getName()} (ID: ${file.getId()})`);
    
    return {
      name: file.getName(),
      id: file.getId(),
      url: file.getUrl()
    };
    
  } catch (error) {
    console.error(`Error saving attachment: ${error}`);
    return null;
  }
}

/**
 * Log the processed email details to Google Sheet
 */
function logToSheet(sheet, personName, emailDate, savedFiles, emailSubject) {
  try {
    const timestamp = Utilities.formatDate(emailDate, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const fileNames = savedFiles.map(f => f.name).join(', ');
    const fileUrls = savedFiles.map(f => f.url).join(', ');
    
    // Add a row to the sheet
    sheet.appendRow([
      timestamp,
      personName,
      emailSubject,
      savedFiles.length,
      fileNames,
      fileUrls,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') // Processing timestamp
    ]);
    
    console.log(`Logged to sheet: ${personName} - ${savedFiles.length} files`);
    
  } catch (error) {
    console.error(`Error logging to sheet: ${error}`);
  }
}

/**
 * Get or create the Google Sheet for logging
 */
function getOrCreateSheet() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_TAB_NAME);
    
    if (!sheet) {
      console.log(`Creating new sheet: ${CONFIG.SHEET_TAB_NAME}`);
      sheet = spreadsheet.insertSheet(CONFIG.SHEET_TAB_NAME);
      
      // Add headers
      sheet.getRange(1, 1, 1, 7).setValues([[
        'Email Date',
        'Person Name',
        'Email Subject',
        'File Count',
        'File Names',
        'File URLs',
        'Processed At'
      ]]);
      
      // Format headers
      const headerRange = sheet.getRange(1, 1, 1, 7);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#f0f0f0');
      
      // Auto-resize columns
      sheet.autoResizeColumns(1, 7);
    }
    
    return sheet;
    
  } catch (error) {
    console.error(`Error getting/creating sheet: ${error}`);
    throw error;
  }
}

/**
 * Build the Gmail search query with date filter
 */
function buildSearchQuery(lastProcessedTimestamp) {
  let query = CONFIG.GMAIL_SEARCH_QUERY;
  
  if (lastProcessedTimestamp > 0) {
    // Add date filter to only search emails newer than the last processed
    const afterDate = new Date(lastProcessedTimestamp);
    const dateString = Utilities.formatDate(afterDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');
    query += ` after:${dateString}`;
  }
  
  return query;
}

/**
 * Get the last processed timestamp from PropertiesService
 */
function getLastProcessedTimestamp() {
  const properties = PropertiesService.getScriptProperties();
  const timestamp = properties.getProperty(CONFIG.LAST_PROCESSED_PROPERTY);
  return timestamp ? parseInt(timestamp) : 0;
}

/**
 * Set the last processed timestamp in PropertiesService
 */
function setLastProcessedTimestamp(timestamp) {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(CONFIG.LAST_PROCESSED_PROPERTY, timestamp.toString());
}

/**
 * Setup function to create time-driven trigger
 * Run this once manually to set up the automation
 */
function setupTrigger() {
  // Delete any existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processConfidentialityAgreements') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create a new trigger to run every 5 minutes
  ScriptApp.newTrigger('processConfidentialityAgreements')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  console.log('Trigger created to run every 5 minutes');
}

/**
 * Test function to process a single email manually
 * Useful for testing before setting up the trigger
 */
function testProcessing() {
  // Set a recent timestamp to test with recent emails
  const testTimestamp = new Date().getTime() - (24 * 60 * 60 * 1000); // 24 hours ago
  setLastProcessedTimestamp(testTimestamp);
  
  console.log('Running test processing...');
  processConfidentialityAgreements();
}

/**
 * Reset the last processed timestamp (useful for testing)
 */
function resetLastProcessedTimestamp() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(CONFIG.LAST_PROCESSED_PROPERTY);
  console.log('Last processed timestamp reset');
} 
