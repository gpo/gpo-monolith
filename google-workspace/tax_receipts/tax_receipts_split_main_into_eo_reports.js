/**
 *
 *
 * If you need to
 */

// TODO: filter out Receipt_Status = C & L only I (Issued) should be kept

/**
 * Add a menu to the spreadsheet so the Admin team can run this task
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Custom Scripts')
    .addItem('Generate EO Reports', 'generateEOReports')
    .addToUi();
}

function generateEOReports() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // wait 10 seconds for lock
    exportFilteredCSVs();
  } catch (e) {
    throwAndDisplayError(
      'The script is already running. Please try again later.',
    );
  } finally {
    lock.releaseLock();
  }
}

function exportFilteredCSVs() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const generatedFilesFolder = getOrCreateExportFolder(ss);

    const { headers, reports } = segmentReports(ss);

    const reportingPeriodNamesMap = getPeriodNames(ss);

    saveReports(
      headers,
      reports,
      reportingPeriodNamesMap,
      generatedFilesFolder,
    );
  } catch (e) {
    throwAndDisplayError('Something went wrong. Please try again later');
  }
}

function getOrCreateExportFolder(ss) {
  const folderName = 'EO Contribution Reports (Generated)';
  const mainFile = DriveApp.getFileById(ss.getId());
  const parentFolder = mainFile.getParents().next();

  // Check if the folder exists
  const folders = parentFolder.getFoldersByName(folderName);
  while (folders.hasNext()) {
    const folder = folders.next();
    deleteFolderAndContents(folder); // Delete the folder and all its contents
  }

  // Create a new folder
  return parentFolder.createFolder(folderName);
}

function deleteFolderAndContents(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true); // Move files to trash
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    deleteFolderAndContents(subfolders.next()); // Recursively delete subfolders
  }

  folder.setTrashed(true); // Finally, delete the folder itself
}

function segmentReports(ss) {
  const sheetName = 'FINAL';
  const data = ss.getSheetByName(sheetName).getDataRange().getValues();
  if (data.length < 2) {
    throwAndDisplayError(`No data found in sheet ${sheetName}`);
  }

  const reports = reportsObject();

  const headers = data[0]; // First row as headers

  const records = data.slice(1); // Data excluding headers
  records.forEach((row) => {
    let politicalEntity = row[6]; // Column G
    if (politicalEntity.startsWith('GPO ')) {
      politicalEntity = politicalEntity.substring(4);
    }
    const reportingPeriod = row[11]; // Column L

    if (!politicalEntity || !reportingPeriod) {
      throwAndDisplayError(
        `row is missing a political entity: ${politicalEntity} ` +
          `or a reporting period: ${reportingPeriod}. ${convertToCSV([row])}`,
      );
    }

    reports[reportingPeriod].all.push(row);
    reports[reportingPeriod].entityReports[politicalEntity].push(row);

    const amount = Number(row[7]);
    if (amount >= 200.01) {
      reports[reportingPeriod].entityS2P2Reports[politicalEntity].push(row);
      reports[reportingPeriod].s2p2.push(row);
    }
  });

  return { headers, reports };
}

function getPeriodNames(ss) {
  const data = ss
    .getSheetByName('Reporting_Periods')
    .getDataRange()
    .getValues();
  const records = data.slice(1); // Data excluding headers

  return records.reduce((map, row) => {
    const periodNumber = row[0];
    const periodName = row[1];

    map[periodNumber] = periodName;
    return map;
  }, {});
}

function saveReports(
  headers,
  reports,
  reportingPeriodNamesMap,
  generatedFilesFolder,
) {
  for (const reportingPeriod in reports) {
    const report = reports[reportingPeriod];
    const reportingPeriodName = reportingPeriodNamesMap[reportingPeriod];
    const reportingPeriodFolder = findOrCreateFolder(
      generatedFilesFolder,
      `${reportingPeriod} - ${reportingPeriodName}`,
    );

    // Save the file with the following naming convention: Party + ED + Event + ALL (ie. ABC 123 2023 Annual ALL)
    const allReportFileName = `GPO ${reportingPeriodName} ALL.csv`;

    const allReportCsvContent = convertToCSV([headers].concat(report.all));
    saveCSV(allReportFileName, allReportCsvContent, reportingPeriodFolder);

    // Save the file with the following naming convention: Party + ED + Event + S2P2 (ie. ABC 123 2023 Annual S2P2)
    const s2p2ReportFileName = `GPO ${reportingPeriodName} S2P2.csv`;

    const s2p2CsvContent = convertToCSV([headers].concat(report.s2p2));
    saveCSV(s2p2ReportFileName, s2p2CsvContent, reportingPeriodFolder);

    const entityReportsFolder = findOrCreateFolder(
      reportingPeriodFolder,
      'entity reports',
    );

    for (const politicalEntity in report.entityReports) {
      // Save the file with the following naming convention: Party + ED + Event + ALL (ie. ABC 123 2023 Annual ALL)
      const fileName = `GPO ${politicalEntity} ${reportingPeriodName} ALL.csv`;

      const csvContent = convertToCSV(
        [headers].concat(report.entityReports[politicalEntity]),
      );
      saveCSV(fileName, csvContent, entityReportsFolder);
    }
    for (const politicalEntity in report.entityReports) {
      // Save the file with the following naming convention: Party + ED + Event + ALL (ie. ABC 123 2023 Annual ALL)
      const fileName = `GPO ${politicalEntity} ${reportingPeriodName} S2P2.csv`;

      const csvContent = convertToCSV(
        [headers].concat(report.entityS2P2Reports[politicalEntity]),
      );
      saveCSV(fileName, csvContent, entityReportsFolder);
    }
  }
}

function findOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  while (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

function convertToCSV(dataArray) {
  return dataArray
    .map((row) =>
      row
        .map((value) => {
          if (value instanceof Date) {
            return formatDateToMMDDYYYY(value);
          }

          return `"${value}"`;
        })
        .join(','),
    )
    .join('\n');
}

function formatDateToMMDDYYYY(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}${day}${year}`;
}

function saveCSV(fileName, content, folder) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  folder.createFile(fileName, content, MimeType.CSV);
}

function throwAndDisplayError(message) {
  SpreadsheetApp.getUi().alert(message);
  throw new Error(message);
}

function mapWithDefaultArray() {
  return new Proxy(
    {},
    {
      get: (target, name) =>
        name in target ? target[name] : (target[name] = []),
    },
  );
}

class ReportingPeriod {
  constructor() {
    this.all = [];
    this.s2p2 = [];
    this.entityReports = mapWithDefaultArray();
    this.entityS2P2Reports = mapWithDefaultArray();
  }
}

function reportsObject() {
  return new Proxy(
    {},
    {
      get: (target, name) =>
        name in target ? target[name] : (target[name] = new ReportingPeriod()),
    },
  );
}
