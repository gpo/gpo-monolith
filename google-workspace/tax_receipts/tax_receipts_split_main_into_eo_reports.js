/**
 * This AppScript is designed to be used on a full calendar version of a tax receipt report.
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
    lock.waitLock(100);
  } catch (e) {
    throwAndDisplayError(
      'The script is already running. Please try again later.',
    );
  }

  try {
    renameEOReportsFolder('PROCESSING');
    exportFilteredCSVs();
    renameEOReportsFolder('DONE');
    SpreadsheetApp.getUi().alert('Generating EO Reports has succeeded');
  } catch (e) {
    renameEOReportsFolder('ERROR');

    if (!e.hasWarned) {
      SpreadsheetApp.getUi().alert(
        'Something went wrong. Please try again later',
      );
    }
  } finally {
    lock.releaseLock();
  }
}

function exportFilteredCSVs() {
  const generatedFilesFolder = getOrCreateEOReportFolder();
  deleteContents(generatedFilesFolder);

  const reports = segmentReports(ss);

  const reportingPeriodNamesMap = getPeriodNames(ss);

  saveReports(reports, reportingPeriodNamesMap, generatedFilesFolder);
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

  if (!/^(PROCESSING|DONE|ERROR)$/.test(status)) {
    throwAndDisplayError(`Unknown status: ${status}`);
  }

  eoReportFolder.setName(
    `${GENERATED_EO_REPORT_PREFIX} (${status} ${timestamp})`,
  );
}

function deleteContents(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    deleteContents(subfolders.next()); // Recursively delete subfolders
  }
}

function segmentReports() {
  const sheet = ss.getSheetByName('FINAL');
  if (!sheet) {
    throwAndDisplayError(
      'The "FINAL" sheet is missing. Please add it and try again.',
    );
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    throwAndDisplayError(`No data found in sheet FINAL`);
  }

  const reports = mapWithDefault(() => new ReportingPeriod());

  // process all records excluding headers
  data.slice(1).forEach((row) => {
    const politicalEntity = extractPoliticalEntity(row[6]);
    const reportingPeriod = row[11]; // Column L

    if (!politicalEntity || !reportingPeriod) {
      throwAndDisplayError(
        `row is missing a political entity: ${politicalEntity} ` +
          `or a reporting period: ${reportingPeriod}. ${convertToCSV([row])}`,
      );
    }

    const allRow = AllRow.newFromRow(row);
    reports[reportingPeriod].all.push(allRow);
    reports[reportingPeriod].entityReports[politicalEntity].push(allRow);

    addToS2p2Report(
      reports[reportingPeriod].entityS2P2Reports[politicalEntity],
      row,
    );
  });

  // remove rows from the s2p2 report that are not >= 200.01
  for (const reportingPeriod in reports) {
    const report = reports[reportingPeriod];
    for (const politicalEntity in report.entityReports) {
      const s2p2Report = report.entityS2P2Reports[politicalEntity];
      for (const contributorID in s2p2Report) {
        if (s2p2Report[contributorID].AggregateContributionAmount < 200.01) {
          delete s2p2Report[contributorID];
        }
      }
    }
  }

  return reports;
}

function addToS2p2Report(s2p2Report, row) {
  if (row[3] !== 'I') return; // only process rows with Receipt_Status 'Issued'

  const contributorID = row[1];
  const amount = Number(row[7]);

  const s2p2Row = s2p2Report[contributorID];
  if (s2p2Row) {
    s2p2Row.AggregateContributionAmount += amount;
  } else {
    s2p2Report[contributorID] = S2P2Row.newFromRow(row);
  }
}

function extractPoliticalEntity(politicalEntity) {
  if (politicalEntity.startsWith('GPO ')) {
    return politicalEntity.substring(4);
  }
  return politicalEntity;
}

function getPeriodNames() {
  const sheet = ss.getSheetByName('Reporting Periods');
  if (!sheet) {
    throwAndDisplayError(
      'The "Reporting Periods" sheet is missing. Please add it and try again.',
    );
  }
  const data = sheet.getDataRange().getValues();
  const records = data.slice(1); // Data excluding headers

  return records.reduce((map, row) => {
    const periodNumber = row[0];
    const periodName = row[1];

    map[periodNumber] = periodName;
    return map;
  }, {});
}

function saveReports(reports, reportingPeriodNamesMap, generatedFilesFolder) {
  for (const reportingPeriod in reports) {
    const report = reports[reportingPeriod];
    const reportingPeriodName = reportingPeriodNamesMap[reportingPeriod];
    const reportingPeriodFolder = findOrCreateFolder(
      generatedFilesFolder,
      `${reportingPeriod} - ${reportingPeriodName}`,
    );

    saveAllCsv(
      reportingPeriodFolder,
      // Save the file with the following naming convention:
      // Party + ED + Event + ALL (i.e. ABC 123 2023 Annual ALL)
      `GPO ${reportingPeriodName} ALL.csv`,
      report.all,
    );

    saveS2p2Csv(
      reportingPeriodFolder,
      // Save the file with the following naming convention:
      // Party + ED + Event + S2P2 (i.e. ABC 123 2023 Annual S2P2)
      `GPO ${reportingPeriodName} S2P2.csv`,
      Object.values(report.entityS2P2Reports).flatMap((report) =>
        Object.values(report),
      ),
    );

    const entityReportsFolder = findOrCreateFolder(
      reportingPeriodFolder,
      'entity reports',
    );

    for (const politicalEntity in report.entityReports) {
      saveAllCsv(
        entityReportsFolder,
        // Please save the file with the following naming convention:
        // `Party + ED + Event + ALL` (i.e. ABC 123 2023 Annual ALL)
        `GPO ${politicalEntity} ${reportingPeriodName} ALL.csv`,
        report.entityReports[politicalEntity],
      );
    }

    for (const politicalEntity in report.entityS2P2Reports) {
      saveS2p2Csv(
        entityReportsFolder,
        // Please save the file with the following naming convention:
        // `Party + ED + Event + S2P2` (i.e. ABC 123 2023 Annual S2P2)
        `GPO ${politicalEntity} ${reportingPeriodName} S2P2.csv`,
        Object.values(report.entityS2P2Reports[politicalEntity]),
      );
    }
  }
}

function saveAllCsv(folder, fileName, report) {
  const rows = report.map((row) => row.getValues());

  const csvContent = convertToCSV([AllRow.headers()].concat(rows));
  saveCSV(folder, fileName, csvContent);
}

function saveS2p2Csv(folder, fileName, s2p2Rows) {
  if (s2p2Rows.length === 0) {
    // if the report is empty don't print it
    return;
  }

  const rows = s2p2Rows
    .sort((a, b) => a.ContributorID - b.ContributorID)
    .map((s2p2Row) => s2p2Row.getValues());

  const csvContent = convertToCSV([S2P2Row.headers()].concat(rows));
  saveCSV(folder, fileName, csvContent);
}

function findOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

function convertToCSV(dataArray) {
  return dataArray
    .map((row) =>
      row
        .map((value) => {
          const trimmed = String(value).trim();
          return /[,\s]/.test(trimmed) ? `"${trimmed}"` : trimmed;
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

function saveCSV(folder, fileName, content) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  folder.createFile(fileName, content, MimeType.CSV);
}

function throwAndDisplayError(message) {
  SpreadsheetApp.getUi().alert(message);
  const e = new Error(message);
  e.hasWarned = true;
  return e;
}

function mapWithDefault(fun) {
  return new Proxy(
    {},
    {
      get: (target, name) =>
        name in target ? target[name] : (target[name] = fun()),
    },
  );
}

class ReportingPeriod {
  constructor() {
    this.all = [];
    this.entityReports = mapWithDefault(() => []);
    this.entityS2P2Reports = mapWithDefault(() => ({}));
  }
}

class AllRow {
  constructor(
    PartyID,
    ContributorID,
    ReceiptNumber,
    ReceiptStatus,
    AgencyContribution,
    PoliticalEntityType,
    PoliticalEntity,
    ContributionAmount,
    ContributionType,
    AcceptanceDate,
    ReceiptIssuanceDate,
    ContributionPeriodID,
    ContributorType,
    ContributorLastName,
    ContributorFirstName,
    OrganizationName,
    ContributorAddress,
    ContributorCity,
    ContributorProvince,
    ContributorPostalCode,
  ) {
    this.PartyID = PartyID;
    this.ContributorID = ContributorID;
    this.ReceiptNumber = ReceiptNumber;
    this.ReceiptStatus = ReceiptStatus;
    this.AgencyContribution = AgencyContribution;
    this.PoliticalEntityType = PoliticalEntityType;
    this.PoliticalEntity = PoliticalEntity;
    this.ContributionAmount = ContributionAmount;
    this.ContributionType = ContributionType;
    this.AcceptanceDate = AcceptanceDate;
    this.ReceiptIssuanceDate = ReceiptIssuanceDate;
    this.ContributionPeriodID = ContributionPeriodID;
    this.ContributorType = ContributorType;
    this.ContributorLastName = ContributorLastName;
    this.ContributorFirstName = ContributorFirstName;
    this.OrganizationName = OrganizationName;
    this.ContributorAddress = ContributorAddress;
    this.ContributorCity = ContributorCity;
    this.ContributorProvince = ContributorProvince;
    this.ContributorPostalCode = ContributorPostalCode;
  }

  static headers() {
    return [
      'Party_ID',
      'Contributor_ID',
      'Receipt_Number',
      'Receipt_Status',
      'Agency_Contribution',
      'Political_Entity_Type',
      'Political_Entity',
      'Contribution_Amount',
      'Contribution_Type',
      'Acceptance_Date',
      'Receipt_Issuance_Date',
      'Contribution_Period_ID',
      'Contributor_Type',
      'Contributor_Last_Name',
      'Contributor_First_Name',
      'Organization_Name',
      'Contributor_Address',
      'Contributor_City',
      'Contributor_Province',
      'Contributor_Postal_Code',
    ];
  }

  static newFromRow(row) {
    return new AllRow(
      /* PartyID */ row[0],
      /* ContributorID */ row[1],
      /* ReceiptNumber */ row[2],
      /* ReceiptStatus */ row[3],
      /* AgencyContribution */ row[4],
      /* PoliticalEntityType */ row[5],
      /* politicalEntity */ extractPoliticalEntity(row[6]),
      /* ContributionAmount */ Number(row[7]),
      /* ContributionType */ row[8],
      /* AcceptanceDate */ row[9],
      /* ReceiptIssuanceDate */ row[10],
      /* ContributionPeriodID */ row[11],
      /* ContributorType */ row[12],
      /* ContributorLastName */ row[13],
      /* ContributorFirstName */ row[14],
      /* OrganizationName */ row[15],
      /* ContributorAddress */ row[16],
      /* ContributorCity */ row[17],
      /* ContributorProvince */ row[18],
      /* ContributorPostalCode */ row[19],
    );
  }

  getValues() {
    return [
      this.PartyID,
      this.ContributorID,
      this.ReceiptNumber,
      this.ReceiptStatus,
      this.AgencyContribution,
      this.PoliticalEntityType,
      this.PoliticalEntity,
      this.ContributionAmount,
      this.ContributionType,
      formatDateToMMDDYYYY(this.AcceptanceDate),
      formatDateToMMDDYYYY(this.ReceiptIssuanceDate),
      this.ContributionPeriodID,
      this.ContributorType,
      this.ContributorLastName,
      this.ContributorFirstName,
      this.OrganizationName,
      this.ContributorAddress,
      this.ContributorCity,
      this.ContributorProvince,
      this.ContributorPostalCode,
    ];
  }
}

class S2P2Row {
  constructor(
    ContributorID,
    PoliticalEntityType,
    PoliticalEntity,
    ContributionPeriodID,
    ContributorType,
    ContributorLastName,
    ContributorFirstName,
    ContributorAddress,
    ContributorCity,
    ContributorProvince,
    ContributorPostalCode,
    AggregateContributionAmount,
  ) {
    this.ContributorID = ContributorID;
    this.PoliticalEntityType = PoliticalEntityType;
    this.PoliticalEntity = PoliticalEntity;
    this.ContributionPeriodID = ContributionPeriodID;
    this.ContributorType = ContributorType;
    this.ContributorLastName = ContributorLastName;
    this.ContributorFirstName = ContributorFirstName;
    this.ContributorAddress = ContributorAddress;
    this.ContributorCity = ContributorCity;
    this.ContributorProvince = ContributorProvince;
    this.ContributorPostalCode = ContributorPostalCode;
    this.AggregateContributionAmount = AggregateContributionAmount;
  }

  static headers() {
    return [
      'Party_ID',
      'Contributor_ID',
      'Political_Entity_Type',
      'Political_Entity',
      'Contribution_Period_ID',
      'Contributor_Type',
      'Contributor_Last_Name',
      'Contributor_First_Name',
      'Organization_Name',
      'Contributor_Address',
      'Contributor_City',
      'Contributor_Province',
      'Contributor_Postal_Code',
      'Aggregate_Contribution_Amount',
    ];
  }

  static newFromRow(row) {
    return new S2P2Row(
      /*contributorID*/ row[1],
      /*PoliticalEntityType*/ row[5],
      /* politicalEntity */ extractPoliticalEntity(row[6]),
      /*ContributionPeriodID*/ row[11],
      /*ContributorType*/ row[5],
      /*ContributorLastName*/ row[13],
      /*ContributorFirstName*/ row[14],
      /*ContributorAddress*/ row[16],
      /*ContributorCity*/ row[17],
      /*ContributorProvince*/ row[18],
      /*ContributorPostalCode*/ row[19],
      /*AggregateContributionAmount*/ Number(row[7]),
    );
  }

  getValues() {
    return [
      /*PartyID*/ 8,
      this.ContributorID,
      this.PoliticalEntityType,
      this.PoliticalEntity,
      this.ContributionPeriodID,
      this.ContributorType,
      this.ContributorLastName,
      this.ContributorFirstName,
      /*OrganizationName*/ '',
      this.ContributorAddress,
      this.ContributorCity,
      this.ContributorProvince,
      this.ContributorPostalCode,
      this.AggregateContributionAmount,
    ];
  }
}
