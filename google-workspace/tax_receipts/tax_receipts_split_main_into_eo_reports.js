/**
 * This AppScript is designed to be used on a full callendar version of a tax receipt report.
 * example: https://docs.google.com/spreadsheets/d/1jeMiZ2uQQSA5UkNliFgiUg9bkSifIQNH4MnlJZwcVdg/edit
 */

const GENERATED_EO_REPORT_PREFIX = 'Generated EO Contribution Reports';
const ss = SpreadsheetApp.getActiveSpreadsheet();

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
    lock.waitLock(1);
    renameEOReportsFolder('PROCESSING');
    exportFilteredCSVs();
    renameEOReportsFolder('DONE');
  } catch (e) {
    renameEOReportsFolder('ERROR');
    throwAndDisplayError(
      'The script is already running. Please try again later.',
    );
  } finally {
    lock.releaseLock();
  }
}

function exportFilteredCSVs() {
  try {
    const generatedFilesFolder = getOrCreateEOReportFolder();
    deleteContents(generatedFilesFolder); // Delete the folder and all its contents

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

let eoReportFolderCache = false;
function getOrCreateEOReportFolder() {
  if (eoReportFolderCache) return eoReportFolderCache;

  const mainSpreadSheet = DriveApp.getFileById(ss.getId());
  const parentFolder = mainSpreadSheet.getParents().next();

  const folders = parentFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().startsWith(GENERATED_EO_REPORT_PREFIX)) {
      eoReportFolderCache = folder;
      return folder;
    }
  }
  eoReportFolderCache = parentFolder.createFolder(GENERATED_EO_REPORT_PREFIX);
  return eoReportFolderCache;
}

const startTime = new Date();
const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'short',
  timeStyle: 'short',
});
function renameEOReportsFolder(status) {
  const eoReportFolder = getOrCreateEOReportFolder();
  const timestamp = dateTimeFormatter.format(startTime).replace(',', '');

  let statusName;
  switch (status) {
    case 'PROCESSING':
      statusName = `(PROCESSING`;
      break;
    case 'DONE':
      statusName = `(DONE`;
      break;
    case 'ERROR':
      statusName = `(ERROR`;
      break;
    default:
      throw new Error(`Unknown status: ${status}`);
  }

  eoReportFolder.setName(
    `${GENERATED_EO_REPORT_PREFIX} ${statusName} ${timestamp} )`,
  );
}

function deleteContents(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true); // Move files to trash
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    deleteContents(subfolders.next()); // Recursively delete subfolders
  }
}

function segmentReports() {
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

function getPeriodNames() {
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
