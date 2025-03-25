function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Custom Scripts')
    .addItem('Export CSVs', 'exportFilteredCSVs')
    .addToUi();
}

function exportFilteredCSVs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var folder = getOrCreateExportFolder(ss);

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('No data found.');
    return;
  }

  var headers = data[0]; // First row as headers
  var records = data.slice(1); // Data excluding headers

  var groupedData = {};
  var s2p2Report = [];

  records.forEach((row) => {
    var politicalEntity = row[6]; // Column G
    var reportPeriod = row[11]; // Column L

    if (!politicalEntity || !reportPeriod) {
      throw Error(
        `row is missing a political entity: ${politicalEntity} or a report period: ${reportPeriod}. ${convertToCSV([row])}`,
      );
    }

    if (!groupedData[reportPeriod]) {
      groupedData[reportPeriod] = {};
    }

    if (!groupedData[reportPeriod][politicalEntity]) {
      groupedData[reportPeriod][politicalEntity] = [];
    }

    groupedData[reportPeriod][politicalEntity].push(row);

    var amount = Number(row[7]);
    if (amount >= 200.01 && politicalEntity.trim() === 'GPO') {
      s2p2Report.push(row);
    }
  });

  for (var reportPeriod in groupedData) {
    for (var politicalEntity in groupedData[reportPeriod]) {
      var fileName = `Period ${reportPeriod} - ${politicalEntity}.csv`;

      //var csvContent = convertToCSV([headers].concat(groupedData[reportPeriod][politicalEntity]));
      //saveCSV(fileName, csvContent, folder);
    }
  }

  var s2p2CsvContent = convertToCSV([headers].concat(s2p2Report));
  saveCSV('s2p2 report.csv', s2p2CsvContent, folder);
}

function getOrCreateExportFolder(ss) {
  var masterFile = DriveApp.getFileById(ss.getId());
  var parentFolder = masterFile.getParents().next();

  // Check if the folder exists
  var folders = parentFolder.getFoldersByName('csv_exports');
  while (folders.hasNext()) {
    var folder = folders.next();
    deleteFolderAndContents(folder); // Delete the folder and all its contents
  }

  // Create a new folder
  return parentFolder.createFolder('csv_exports');
}

function deleteFolderAndContents(folder) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true); // Move files to trash
  }

  var subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    deleteFolderAndContents(subfolders.next()); // Recursively delete subfolders
  }

  folder.setTrashed(true); // Finally, delete the folder itself
}

function convertToCSV(dataArray) {
  return dataArray
    .map((row) => row.map((value) => `"${value}"`).join(','))
    .join('\n');
}

function saveCSV(fileName, content, folder) {
  var files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  folder.createFile(fileName, content, MimeType.CSV);
}
