/**
 * Google Apps Script to export a tab-structured Google Doc into multiple Markdown files.
 *
 * Notes:
 * - Tabs are inferred by Heading 1 sections. Each H1 starts a new tab/file.
 * - Uses only built-in services: DocumentApp and DriveApp.
 * - Creates (or reuses) a folder named "<Document Name> [MD Export]" next to the source Doc.
 * - Idempotent: overwrites existing files with the same names within the export folder.
 * - Writes a detailed export-log.txt inside the export folder after each run.
 *
 * How to use:
 * - Open the target Google Doc, then run exportDocTabsToMarkdown() from Apps Script bound to the Doc
 *   or paste this file into an Apps Script project and set DOC_ID below.
 */

// Optional: hardcode a Doc ID to run from a standalone Apps Script project.
// Leave empty to use the active document when run as a bound script.
var DOC_ID = '';
var DEBUG_VERBOSE = true; // set false to reduce log noise

/** Add custom menu in Google Docs UI */
function onOpen() {
  try {
    DocumentApp.getUi()
      .createMenu('Markdown Export')
      .addItem('Export tabs to Markdown', 'exportDocTabsToMarkdown')
      .addToUi();
  } catch (e) {
    Logger.log('Failed to add menu: ' + e);
  }
}

function onInstall(e) {
  onOpen(e);
}

/** Entry point */
function exportDocTabsToMarkdown() {
  var start = new Date();
  _logLines = []; // reset per run
  _runId = 'run-' + start.getTime();
  log('--- Export run started: ' + start.toISOString() + ' (' + _runId + ') ---');

  try {
    var doc = (DOC_ID && DOC_ID.trim())
      ? DocumentApp.openById(DOC_ID.trim())
      : DocumentApp.getActiveDocument();
    if (!doc) {
      logError('Could not open document.');
      return;
    }

    var docName = doc.getName();
    var docId = doc.getId();
    log('Document: ' + docName + ' (' + docId + ')');

    var body = doc.getBody();
    if (!body) {
      logError('Document has no body.');
      return;
    }

    var exportFolder = getOrCreateExportFolder(doc);
    log('Export folder: ' + exportFolder.getName() + ' [' + exportFolder.getId() + ']');
    _assetsFolder = findOrCreateFolderByName(exportFolder, 'assets');
    if (DEBUG_VERBOSE) logDebug('Assets folder: ' + _assetsFolder.getName() + ' [' + _assetsFolder.getId() + ']');

    // Clean export directory before starting
    cleanExportFolder(exportFolder, _assetsFolder);

    // Strictly use Tabs API path
    var tabsApi = (doc.getTabs && typeof doc.getTabs === 'function') ? doc.getTabs() : [];
    if (!tabsApi || tabsApi.length === 0) {
      logError('No tabs found. This exporter only supports Docs Tabs.');
      flushLogsToFile(exportFolder);
      return;
    }

    log('Using Tabs API; top-level tabs detected: ' + tabsApi.length);
    var writtenTabs = exportTabsMarkdown(doc, tabsApi, exportFolder);
    flushLogsToFile(exportFolder);
    var endTabs = new Date();
    log('--- Export run completed (Tabs API): ' + endTabs.toISOString() + ' ---');
    Logger.log('Completed. Tabs written: ' + writtenTabs + '. Folder: ' + exportFolder.getUrl());
  } catch (e) {
    logError('Unhandled error in exportDocTabsToMarkdown: ' + (e && e.message ? e.message : e));
    try { logDebug('Stack: ' + (e && e.stack ? e.stack : 'n/a')); } catch (ignored) {}
  }
}

// --- Tabs API export (if available) ---
function exportTabsMarkdown(doc, topLevelTabs, exportFolder) {
  var totalWritten = 0;
  var indexPath = [];
  for (var i = 0; i < topLevelTabs.length; i++) {
    indexPath = [i + 1];
    totalWritten += processTabRecursive(doc, topLevelTabs[i], exportFolder, indexPath, []);
  }
  return totalWritten;
}

function processTabRecursive(doc, tab, exportFolder, indexPath, titlePath) {
  var count = 0;
  try {
    var title = safeTabTitle(tab);
    var newTitlePath = titlePath.concat([title]);
    var indexPrefix = indexPath.join('.');

    var documentTab = tab.asDocumentTab();
    var tabBody = documentTab.getBody();
    var mdContent = convertBodyToMarkdown(tabBody);

    var baseName = indexPrefix + '_' + sanitizeFileName(newTitlePath.join(' — '));
    var fileName = baseName + '.md';
    writeOrReplaceFile(exportFolder, fileName, mdContent);
    log('Wrote (tab): ' + fileName + ' (' + mdContent.length + ' chars)');
    count++;

    var children = (tab.getChildTabs && typeof tab.getChildTabs === 'function') ? tab.getChildTabs() : [];
    if (children && children.length > 0) {
      for (var c = 0; c < children.length; c++) {
        var childIndexPath = indexPath.concat([c + 1]);
        count += processTabRecursive(doc, children[c], exportFolder, childIndexPath, newTitlePath);
      }
    }
  } catch (e) {
    logWarn('Failed processing tab: ' + (e && e.message ? e.message : e));
  }
  return count;
}

function safeTabTitle(tab) {
  try {
    if (tab.getTitle) return tab.getTitle() || 'Untitled Tab';
  } catch (e) {}
  try {
    if (tab.getTabProperties && tab.getTabProperties()) {
      var props = tab.getTabProperties();
      if (props.getTitle) return props.getTitle() || 'Untitled Tab';
    }
  } catch (e2) {}
  return 'Untitled Tab';
}

function convertBodyToMarkdown(body) {
  var elements = [];
  var total = body.getNumChildren();
  for (var i = 0; i < total; i++) {
    elements.push(body.getChild(i));
  }
  // Reset tab-local stats
  _statsCurrentTab = { paragraphs: 0, listItems: 0, tables: 0, images: 0, rules: 0, placeholders: 0 };
  return convertElementsToMarkdown(elements);
}

/**
 * Determine or create the export folder next to the source Doc.
 * Name: "<DocName> [MD Export]"
 */
function getOrCreateExportFolder(doc) {
  var exportFolderName = doc.getName() + ' [MD Export]';

  // Try to find the Doc's parent folder(s). If none, default to root.
  var file = DriveApp.getFileById(doc.getId());
  var parents = file.getParents();
  var parentFolder = null;
  if (parents.hasNext()) {
    parentFolder = parents.next();
  } else {
    parentFolder = DriveApp.getRootFolder();
  }

  var folder = findOrCreateFolderByName(parentFolder, exportFolderName);
  return folder;
}

function findOrCreateFolderByName(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(name);
}

function sanitizeFileName(name) {
  return (name || 'Untitled')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clean all files from export and assets folders before export
 */
function cleanExportFolder(exportFolder, assetsFolder) {
  var count = 0;
  var assetsCount = 0;

  try {
    // Clean main export folder
    var files = exportFolder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      try {
        file.setTrashed(true);
        count++;
      } catch (e) {
        logWarn('Could not delete file ' + file.getName() + ': ' + e);
      }
    }

    // Clean assets folder
    if (assetsFolder) {
      var assetFiles = assetsFolder.getFiles();
      while (assetFiles.hasNext()) {
        var assetFile = assetFiles.next();
        try {
          assetFile.setTrashed(true);
          assetsCount++;
        } catch (e) {
          logWarn('Could not delete asset file ' + assetFile.getName() + ': ' + e);
        }
      }
    }

    log('Cleaned export folder: ' + count + ' files removed (assets: ' + assetsCount + ' files)');
  } catch (e) {
    logWarn('Error during folder cleanup: ' + e);
  }
}

/** Convert a list of Body child elements to Markdown string. */
function convertElementsToMarkdown(elements) {
  var lines = [];

  // Remember list state to separate blocks cleanly
  var previousWasList = false;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var type = el.getType();

    if (type == DocumentApp.ElementType.PARAGRAPH) {
      var para = el.asParagraph();
      var md = paragraphToMarkdown(para);
      if (md) {
        lines.push(md);
      }
      _statsCurrentTab.paragraphs++;
      previousWasList = false;
    } else if (type == DocumentApp.ElementType.LIST_ITEM) {
      var listLine = listItemToMarkdown(el.asListItem());
      if (previousWasList === false && lines.length > 0) {
        lines.push('');
      }
      lines.push(listLine);
      _statsCurrentTab.listItems++;
      previousWasList = true;
    } else if (type == DocumentApp.ElementType.TABLE) {
      if (lines.length > 0) lines.push('');
      var tbl = tableToMarkdown(el.asTable());
      for (var t = 0; t < tbl.length; t++) {
        lines.push(tbl[t]);
      }
      lines.push('');
      _statsCurrentTab.tables++;
      previousWasList = false;
    } else if (type == DocumentApp.ElementType.HORIZONTAL_RULE) {
      lines.push('');
      lines.push('---');
      lines.push('');
      _statsCurrentTab.rules++;
      previousWasList = false;
    } else {
      // Try generic text if available; otherwise insert placeholder
      try {
        var maybeText = el.getText && el.getText();
        if (maybeText) {
          lines.push(escapeMarkdown(maybeText));
          previousWasList = false;
        } else {
          lines.push(unhandledPlaceholder(type));
          _statsCurrentTab.placeholders++;
          previousWasList = false;
        }
      } catch (e) {
        log('WARN: Skipped unrenderable element: ' + type + ' (' + e + ')');
        lines.push(unhandledPlaceholder(type));
        _statsCurrentTab.placeholders++;
      }
    }
  }

  // Normalize blank lines (avoid triples, trim end)
  var out = [];
  var blankRun = 0;
  for (var j = 0; j < lines.length; j++) {
    var line = String(lines[j]);
    if (line.trim() === '') {
      blankRun++;
      if (blankRun <= 2) out.push('');
    } else {
      blankRun = 0;
      out.push(line);
    }
  }

  return out.join('\n');
}

function paragraphToMarkdown(para) {
  var heading = para.getHeading();
  var text = richContainerToMarkdown(para);

  if (!text.trim()) return '';

  if (heading == DocumentApp.ParagraphHeading.TITLE) return '# ' + text;
  if (heading == DocumentApp.ParagraphHeading.HEADING1) return '# ' + text;
  if (heading == DocumentApp.ParagraphHeading.HEADING2) return '## ' + text;
  if (heading == DocumentApp.ParagraphHeading.HEADING3) return '### ' + text;
  if (heading == DocumentApp.ParagraphHeading.HEADING4) return '#### ' + text;
  if (heading == DocumentApp.ParagraphHeading.HEADING5) return '##### ' + text;
  if (heading == DocumentApp.ParagraphHeading.HEADING6) return '###### ' + text;

  return text;
}

function listItemToMarkdown(item) {
  var nesting = item.getNestingLevel();
  var glyphType = (item.getGlyphType && item.getGlyphType()) || null;
  var isOrdered = false;
  if (glyphType) {
    var g = String(glyphType);
    isOrdered = /NUMBER|ALPHA|ROMAN/i.test(g);
  }

  var prefix = '';
  for (var i = 0; i < nesting; i++) prefix += '  ';
  prefix += isOrdered ? '1. ' : '- ';

  var content = richContainerToMarkdown(item);
  return prefix + content;
}

/**
 * Convert a Paragraph or ListItem rich content (Text runs + Inline Images) to Markdown.
 */
function richContainerToMarkdown(container) {
  var parts = [];
  var childCount = container.getNumChildren ? container.getNumChildren() : 0;
  if (!childCount && container.getText) {
    // Fallback to text-only container style conversion
    return richTextElementToMarkdown(container);
  }
  for (var i = 0; i < childCount; i++) {
    var child = container.getChild(i);
    var type = child.getType();
    if (type == DocumentApp.ElementType.TEXT) {
      parts.push(richTextElementToMarkdown(child));
    } else if (type == DocumentApp.ElementType.INLINE_IMAGE) {
      parts.push(exportInlineImageToMarkdown(child.asInlineImage()));
      _statsCurrentTab.images++;
    } else if (type == DocumentApp.ElementType.FOOTNOTE) {
      // Emit placeholder for footnotes to make omission visible
      log('INFO: Skipping footnote content in markdown output');
      parts.push(unhandledInlinePlaceholder('FOOTNOTE'));
      _statsCurrentTab.placeholders++;
    } else {
      // Attempt to read generic text if present
      try {
        var maybeText = child.getText && child.getText();
        if (maybeText) parts.push(escapeMarkdown(maybeText));
        else parts.push(unhandledInlinePlaceholder(String(type)));
        if (!maybeText) _statsCurrentTab.placeholders++;
      } catch (e) {
        // ignore
        parts.push(unhandledInlinePlaceholder(String(type)));
        _statsCurrentTab.placeholders++;
      }
    }
  }
  return parts.join('');
}

function richTextElementToMarkdown(textElement) {
  var text = textElement.getText();
  if (!text) return '';

  var result = '';
  var indices = textElement.getTextAttributeIndices();
  for (var i = 0; i < indices.length; i++) {
    var start = indices[i];
    var end = (i + 1 < indices.length) ? indices[i + 1] : text.length;
    var segment = text.substring(start, end);
    var attr = textElement.getAttributes(start);
    var segmentMd = escapeMarkdown(segment);
    if (attr.LINK_URL) {
      segmentMd = applyEmphasis(segmentMd, attr);
      segmentMd = '[' + segmentMd + '](' + attr.LINK_URL + ')';
      result += segmentMd;
      continue;
    }
    segmentMd = applyEmphasis(segmentMd, attr);
    result += segmentMd;
  }
  return result;
}

function exportInlineImageToMarkdown(inlineImage) {
  try {
    var blob = inlineImage.getBlob();
    var contentType = blob.getContentType() || '';
    var ext = 'bin';
    if (/png/i.test(contentType)) ext = 'png';
    else if (/jpe?g/i.test(contentType)) ext = 'jpg';
    else if (/gif/i.test(contentType)) ext = 'gif';
    else if (/webp/i.test(contentType)) ext = 'webp';
    else if (/svg/i.test(contentType)) ext = 'svg';

    var indexStr = String(_currentTabIndex + 1);
    var countStr = String(_imageCounter < 1000 ? ('000' + _imageCounter).slice(-3) : _imageCounter);
    _imageCounter++;
    var name = 'tab' + indexStr + '-' + countStr + '.' + ext;

    // Remove existing with same name to keep idempotent
    writeOrReplaceFile(_assetsFolder, name, ''); // create placeholder first to claim the name
    var files = _assetsFolder.getFilesByName(name);
    var file = files.hasNext() ? files.next() : _assetsFolder.createFile(blob.setName(name));
    // Replace content if placeholder
    if (file.getSize() === 0) {
      try { file.setContent(''); } catch (e) {}
      try { file.setTrashed(true); } catch (e2) {}
      file = _assetsFolder.createFile(blob.setName(name));
    } else {
      try { file.setContent(''); file.setTrashed(true); } catch (e3) {}
      file = _assetsFolder.createFile(blob.setName(name));
    }

    if (DEBUG_VERBOSE) logDebug('Saved image: ' + name + ' (' + (blob.getBytes ? blob.getBytes().length : 'n/a') + ' bytes)');
    return '![' + 'image' + '](assets/' + name + ')';
  } catch (e) {
    logWarn('Failed to export inline image: ' + e);
    return '';
  }
}

function applyEmphasis(text, attr) {
  var out = text;
  // Bold
  if (attr.BOLD) out = '**' + out + '**';
  // Italic
  if (attr.ITALIC) out = '_' + out + '_';
  // Strikethrough
  if (attr.STRIKETHROUGH) out = '~~' + out + '~~';
  return out;
}

function tableToMarkdown(table) {
  var rows = table.getNumRows();
  var cols = rows > 0 ? table.getRow(0).getNumCells() : 0;
  if (rows === 0 || cols === 0) return [''];

  var mdRows = [];
  // Gather raw rows
  for (var r = 0; r < rows; r++) {
    var row = table.getRow(r);
    var cells = [];
    for (var c = 0; c < row.getNumCells(); c++) {
      var cell = row.getCell(c);
      var cellText = cell.getText();
      // Convert inline rich text if needed (cells can have multiple elements)
      var cellMd = cellToMarkdown(cell);
      cells.push(cellMd.replace(/\|/g, '\\|').replace(/\n/g, '<br>'));
    }
    mdRows.push('| ' + cells.join(' | ') + ' |');
  }

  // Header separator (assume row 0 is header-like)
  var headerSepParts = [];
  for (var k = 0; k < cols; k++) headerSepParts.push('---');
  mdRows.splice(1, 0, '| ' + headerSepParts.join(' | ') + ' |');

  return mdRows;
}

function cellToMarkdown(cell) {
  var parts = [];
  for (var i = 0; i < cell.getNumChildren(); i++) {
    var child = cell.getChild(i);
    var type = child.getType();
    if (type == DocumentApp.ElementType.PARAGRAPH) {
      var p = paragraphToMarkdown(child.asParagraph());
      parts.push(p);
    } else if (type == DocumentApp.ElementType.LIST_ITEM) {
      parts.push(listItemToMarkdown(child.asListItem()));
    } else {
      try {
        var maybeText = child.getText && child.getText();
        if (maybeText) parts.push(escapeMarkdown(maybeText));
        else parts.push(unhandledInlinePlaceholder(String(type)));
      } catch (e) {
        // note placeholder
        parts.push(unhandledInlinePlaceholder(String(type)));
      }
    }
  }
  return parts.join(' ');
}

function writeOrReplaceFile(folder, name, content) {
  // Remove existing file with same name (idempotent overwrite)
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) {
    var f = existing.next();
    try {
      f.setTrashed(true);
    } catch (e) {
      log('WARN: Could not trash existing file ' + name + ': ' + e);
    }
  }
  var file = folder.createFile(name, content, MimeType.PLAIN_TEXT);
  return file;
}

function escapeMarkdown(text) {
  if (!text) return '';
  // Escape backslashes first
  var out = text.replace(/\\/g, '\\\\');
  // Escape MD special chars likely to appear in prose
  out = out.replace(/([*_`#>\-])/g, '\\$1');
  return out;
}

// --- Logging helpers ---
var _logLines = [];
var _assetsFolder = null;
var _currentTabIndex = 0;
var _imageCounter = 1;
var _statsCurrentTab = { paragraphs: 0, listItems: 0, tables: 0, images: 0, rules: 0, placeholders: 0 };
var _runId = '';

function unhandledPlaceholder(type) {
  // Block-level visible marker for missed content
  var t = String(type);
  return '> [Unrendered element: ' + t + ']';
}

function unhandledInlinePlaceholder(type) {
  // Inline-friendly marker
  var t = String(type);
  return '[Unrendered:' + t + ']';
}

function logDebug(msg) {
  if (DEBUG_VERBOSE) log('[DEBUG] ' + msg);
}

function logWarn(msg) {
  log('[WARN] ' + msg);
}

function logError(msg) {
  log('[ERROR] ' + msg);
}
function log(msg) {
  _logLines.push(new Date().toISOString() + ' ' + msg);
  Logger.log(msg);
}

function flushLogsToFile(folder) {
  var name = 'export-log.txt';
  var content = _logLines.join('\n') + '\n';

  // Append behavior: if a log exists, append; else create
  var files = folder.getFilesByName(name);
  if (files.hasNext()) {
    var file = files.next();
    try {
      var prev = file.getBlob().getDataAsString();
      file.setContent(prev + content);
      return;
    } catch (e) {
      // fallback to replace
      file.setTrashed(true);
    }
  }

  folder.createFile(name, content, MimeType.PLAIN_TEXT);
}

/**
 * FAQ: Can we get the same Markdown as "Copy as Markdown" in Google Drive/Docs?
 * As of now, Apps Script does not expose the same internal conversion used by
 * the UI feature. This script approximates Markdown by walking the document
 * model. If Google later exposes such an API, you can swap the converter here.
 */
