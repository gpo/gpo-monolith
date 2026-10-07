/**
 * Google Apps Script for detecting duplicates in sorted numerical columns
 * This script provides functions to identify duplicate values by comparing
 * each row with its adjacent rows (previous and next).
 */

/**
 * Main function to find duplicates in a sorted numerical column
 * @param {string} sheetName - Name of the sheet to analyze (optional, defaults to active sheet)
 * @param {string} columnLetter - Column letter to check for duplicates (e.g., "A", "B", "C")
 * @param {number} startRow - Starting row number (optional, defaults to 2 to skip header)
 * @param {number} endRow - Ending row number (optional, defaults to last row with data)
 * @return {Array} Array of row numbers that contain duplicates
 */
function findDuplicatesInSortedColumn(sheetName = null, columnLetter = "A", startRow = 2, endRow = null) {
  const sheet = sheetName ? SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName) : SpreadsheetApp.getActiveSheet();
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  // If endRow not specified, get the last row with data
  if (!endRow) {
    endRow = sheet.getLastRow();
  }
  
  // Validate parameters
  if (startRow < 1 || endRow < startRow) {
    throw new Error("Invalid row range");
  }
  
  const duplicates = [];
  const columnIndex = columnLetter.charCodeAt(0) - 65; // Convert A=0, B=1, etc.
  
  // Get all values in the column
  const range = sheet.getRange(startRow, columnIndex + 1, endRow - startRow + 1, 1);
  const values = range.getValues().flat();
  
  // Check each row against adjacent rows
  for (let i = 0; i < values.length; i++) {
    const currentValue = values[i];
    const currentRow = startRow + i;
    
    // Check if current value matches previous or next value
    const isDuplicate = 
      (i > 0 && values[i - 1] === currentValue) || // Previous row
      (i < values.length - 1 && values[i + 1] === currentValue); // Next row
    
    if (isDuplicate) {
      duplicates.push(currentRow);
    }
  }
  
  return duplicates;
}

/**
 * Apply filter to highlight duplicate rows
 * @param {string} sheetName - Name of the sheet to filter (optional, defaults to active sheet)
 * @param {string} columnLetter - Column letter to check for duplicates
 * @param {number} startRow - Starting row number (optional, defaults to 2)
 * @param {number} endRow - Ending row number (optional, defaults to last row with data)
 */
function filterDuplicates(sheetName = null, columnLetter = "A", startRow = 2, endRow = null) {
  const sheet = sheetName ? SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName) : SpreadsheetApp.getActiveSheet();
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const duplicates = findDuplicatesInSortedColumn(sheetName, columnLetter, startRow, endRow);
  
  if (duplicates.length === 0) {
    SpreadsheetApp.getUi().alert("No duplicates found in the specified range.");
    return;
  }
  
  // Clear any existing filters
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  
  // Create a filter range
  const filterRange = sheet.getRange(startRow, 1, endRow - startRow + 1, sheet.getLastColumn());
  const filter = filterRange.createFilter();
  
  // Create a custom formula to show only duplicate rows
  const columnIndex = columnLetter.charCodeAt(0) - 65 + 1; // Convert to 1-based index
  const customFormula = `=OR(${columnLetter}${startRow}=${columnLetter}${startRow-1}, ${columnLetter}${startRow}=${columnLetter}${startRow+1})`;
  
  // Apply the filter
  filter.setColumnFilterCriteria(columnIndex, SpreadsheetApp.newFilterCriteria()
    .whenFormulaSatisfied(customFormula)
    .build());
  
  SpreadsheetApp.getUi().alert(`Filter applied! Found ${duplicates.length} duplicate rows.`);
}

/**
 * Highlight duplicate rows with background color
 * @param {string} sheetName - Name of the sheet to highlight (optional, defaults to active sheet)
 * @param {string} columnLetter - Column letter to check for duplicates
 * @param {number} startRow - Starting row number (optional, defaults to 2)
 * @param {number} endRow - Ending row number (optional, defaults to last row with data)
 * @param {string} color - Background color (optional, defaults to "#FFD9D9" - light red)
 */
function highlightDuplicates(sheetName = null, columnLetter = "A", startRow = 2, endRow = null, color = "#FFD9D9") {
  const sheet = sheetName ? SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName) : SpreadsheetApp.getActiveSheet();
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  
  const duplicates = findDuplicatesInSortedColumn(sheetName, columnLetter, startRow, endRow);
  
  if (duplicates.length === 0) {
    SpreadsheetApp.getUi().alert("No duplicates found in the specified range.");
    return;
  }
  
  // Highlight each duplicate row
  duplicates.forEach(rowNum => {
    const rowRange = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn());
    rowRange.setBackground(color);
  });
  
  SpreadsheetApp.getUi().alert(`Highlighted ${duplicates.length} duplicate rows.`);
}

/**
 * Create a custom menu in the spreadsheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Duplicate Detector')
    .addItem('Find Duplicates in Column A', 'findDuplicatesInColumnA')
    .addItem('Find Duplicates in Column B', 'findDuplicatesInColumnB')
    .addItem('Find Duplicates in Column C', 'findDuplicatesInColumnC')
    .addSeparator()
    .addItem('Filter Duplicates in Column A', 'filterDuplicatesInColumnA')
    .addItem('Filter Duplicates in Column B', 'filterDuplicatesInColumnB')
    .addItem('Filter Duplicates in Column C', 'filterDuplicatesInColumnC')
    .addSeparator()
    .addItem('Highlight Duplicates in Column A', 'highlightDuplicatesInColumnA')
    .addItem('Highlight Duplicates in Column B', 'highlightDuplicatesInColumnB')
    .addItem('Highlight Duplicates in Column C', 'highlightDuplicatesInColumnC')
    .addToUi();
}

// Convenience functions for common columns
function findDuplicatesInColumnA() {
  const duplicates = findDuplicatesInSortedColumn(null, "A");
  SpreadsheetApp.getUi().alert(`Found ${duplicates.length} duplicate rows: ${duplicates.join(", ")}`);
}

function findDuplicatesInColumnB() {
  const duplicates = findDuplicatesInSortedColumn(null, "B");
  SpreadsheetApp.getUi().alert(`Found ${duplicates.length} duplicate rows: ${duplicates.join(", ")}`);
}

function findDuplicatesInColumnC() {
  const duplicates = findDuplicatesInSortedColumn(null, "C");
  SpreadsheetApp.getUi().alert(`Found ${duplicates.length} duplicate rows: ${duplicates.join(", ")}`);
}

function filterDuplicatesInColumnA() {
  filterDuplicates(null, "A");
}

function filterDuplicatesInColumnB() {
  filterDuplicates(null, "B");
}

function filterDuplicatesInColumnC() {
  filterDuplicates(null, "C");
}

function highlightDuplicatesInColumnA() {
  highlightDuplicates(null, "A");
}

function highlightDuplicatesInColumnB() {
  highlightDuplicates(null, "B");
}

function highlightDuplicatesInColumnC() {
  highlightDuplicates(null, "C");
}

/**
 * Example usage function - demonstrates how to use the duplicate detection
 */
function exampleUsage() {
  // Example 1: Find duplicates in column A, starting from row 2
  const duplicates = findDuplicatesInSortedColumn("Sheet1", "A", 2);
  console.log("Duplicate rows:", duplicates);
  
  // Example 2: Apply filter to show only duplicate rows
  filterDuplicates("Sheet1", "A", 2);
  
  // Example 3: Highlight duplicate rows with light red background
  highlightDuplicates("Sheet1", "A", 2, null, "#FFD9D9");
} 