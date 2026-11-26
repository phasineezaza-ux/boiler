/**
 * ============================================================================
 * YearlyArchive.gs — ระบบสำรองข้อมูลปีเก่าเป็น CSV และล้างชีตเมื่อขึ้นปีใหม่
 * ============================================================================
 * หลักการทำงาน (เพื่อใช้งานได้ 10 ปี+ โดย Google Sheet ไม่หนักจนค้าง):
 *   1. Google Sheet เก็บเฉพาะปีปัจจุบัน (Hot Storage)
 *   2. เมื่อขึ้นปีใหม่ (ตั้ง Trigger รันทุกวันที่ 1 ของเดือน และตรวจว่าเดือนนี้คือมกราคม)
 *      ระบบจะดึงข้อมูลทั้งหมดของปีที่ผ่านมา (เช่น ปี 2026 เมื่อขึ้นปี 2027)
 *   3. สร้างไฟล์ CSV (UTF-8 + BOM เปิดใน Excel ภาษาไทยไม่เพี้ยน) เก็บใน Google Drive
 *   4. **ตรวจสอบความถูกต้องของไฟล์ CSV ใน Drive ก่อนลบเสมอ**
 *      - ไฟล์ต้องมีขนาด > 0 ไบต์
 *      - อ่านไฟล์กลับมานับจำนวนบรรทัด ต้องตรงกับ Header + จำนวนแถวที่สำรอง 100%
 *   5. เมื่อตรวจผ่านแล้ว จึงลบแถวของปีเก่าออกจาก Google Sheet เหลือไว้เฉพาะปีปัจจุบัน
 */

/**
 * ฟังก์ชันสำหรับตั้ง Trigger อัตโนมัติ (แนะนำให้รันทุกวันที่ 1 ของเดือน เวลา 01:00-02:00)
 * จะทำงานจริงเฉพาะเดือนมกราคม และมีตัวกันรันซ้ำใน Script Properties
 */
function runAnnualArchiveIfJanuary() {
  const now = new Date();
  const month = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'M'));
  if (month !== 1) {
    Logger.log('ไม่ใช่เดือนมกราคม (เดือนปัจจุบัน: ' + month + ') — ข้ามการสำรองข้อมูลรายปี');
    return;
  }

  const currentYear = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy'));
  const targetYear = currentYear - 1;
  const props = PropertiesService.getScriptProperties();
  const stationIds = getConfiguredStationIds_();

  for (let i = 0; i < stationIds.length; i++) {
    const stId = stationIds[i];
    const doneFlagKey = 'ARCHIVED_YEAR_' + stId + '_' + targetYear;
    if (props.getProperty(doneFlagKey) === 'DONE') {
      Logger.log('จุดวัด ' + stId + ' ปี ' + targetYear + ' ถูกสำรองข้อมูลเรียบร้อยแล้ว');
      continue;
    }
    archiveYearToDriveCsv(targetYear, stId);
  }
}

/**
 * สำรองข้อมูลของปีที่ระบุไป Google Drive และล้างออกจากชีตเมื่อตรวจผ่าน
 * สามารถเรียกทดสอบรันด้วยตนเองได้ เช่น archiveYearToDriveCsv(2026, 'boiler-main')
 */
function archiveYearToDriveCsv(targetYear, stationId) {
  const targetStationId = stationId || 'boiler-main';
  const resolved = resolveStationConfig_(targetStationId);
  if (!resolved.ok) {
    throw new Error(resolved.errorResponse.message);
  }
  if (resolved.config.mode !== 'SPREADSHEET') {
    throw new Error('โหมด PUBLISHED_CSV เป็นแบบอ่านอย่างเดียว ไม่สามารถสำรองและล้างชีตได้ กรุณาใช้โหมด SPREADSHEET');
  }

  const sheet = getTargetSheet_(resolved.config);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('ไม่มีข้อมูลในชีตให้สำรอง');
    return { ok: true, archivedRows: 0 };
  }

  // ใช้ LockService ป้องกันชนกับการเขียนข้อมูลจาก PLC/Gateway ระหว่างย้ายข้อมูล
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const allValues = sheet.getRange(1, 1, sheet.getLastRow(), 4).getValues();
    const header = allValues[0];
    const rowsToArchive = [];
    const rowsToKeep = [];

    for (let i = 1; i < allValues.length; i++) {
      const row = allValues[i];
      const dateStr = normalizeDateCell_(row[CONFIG.COLUMNS.DATE]);
      const rowYear = dateStr ? Number(dateStr.slice(0, 4)) : null;

      if (rowYear === targetYear) {
        rowsToArchive.push(row);
      } else {
        rowsToKeep.push(row);
      }
    }

    if (rowsToArchive.length === 0) {
      Logger.log('ไม่พบข้อมูลของปี ' + targetYear + ' ในชีต');
      return { ok: true, archivedRows: 0 };
    }

    // สร้างเนื้อหา CSV (ใส่ UTF-8 BOM \uFEFF เพื่อให้ Excel เปิดอ่านภาษาไทยถูกต้อง)
    const csvLines = [formatCsvRow_(header)];
    for (let i = 0; i < rowsToArchive.length; i++) {
      const r = rowsToArchive[i];
      const normalizedRow = [
        normalizeDateCell_(r[CONFIG.COLUMNS.DATE]) || r[CONFIG.COLUMNS.DATE],
        normalizeTimeCell_(r[CONFIG.COLUMNS.TIME]) || r[CONFIG.COLUMNS.TIME],
        r[CONFIG.COLUMNS.VALUE],
        r[CONFIG.COLUMNS.UNIT]
      ];
      csvLines.push(formatCsvRow_(normalizedRow));
    }
    const csvContent = '\uFEFF' + csvLines.join('\r\n');

    // บันทึกลง Google Drive
    const folder = getOrCreateArchiveFolder_();
    const timestampTag = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
    const fileName = CONFIG.ARCHIVE.FILE_PREFIX + targetStationId + '_' + targetYear + '_' + timestampTag + '.csv';
    const blob = Utilities.newBlob(csvContent, 'text/csv; charset=utf-8', fileName);
    const createdFile = folder.createFile(blob);

    // ------------------------------------------------------------------------
    // ขั้นตอนสำคัญ: ตรวจสอบว่าไฟล์ถูกสร้างและอ่านกลับได้ครบก่อนลบข้อมูลเก่า!
    // ------------------------------------------------------------------------
    const verifiedFile = DriveApp.getFileById(createdFile.getId());
    if (verifiedFile.getSize() <= 0) {
      throw new Error('ตรวจไฟล์สำรองล้มเหลว: ขนาดไฟล์เป็น 0 ไบต์ (ยกเลิกการลบข้อมูล)');
    }

    const readBackText = verifiedFile.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const readBackLines = readBackText.split(/\r?\n/).filter(function(line) { return line.length > 0; });
    const expectedLineCount = 1 + rowsToArchive.length;

    if (readBackLines.length !== expectedLineCount) {
      throw new Error(
        'ตรวจจำนวนบรรทัดไฟล์สำรองไม่ตรง: คาดหวัง ' + expectedLineCount +
        ' แต่ได้ ' + readBackLines.length + ' (ยกเลิกการลบข้อมูลในชีต)'
      );
    }

    // ผ่านการตรวจสอบ 100% -> เขียนข้อมูลที่เหลือ (ปีปัจจุบัน) กลับลงชีตอย่างปลอดภัย
    sheet.clearContents();
    const newData = [header].concat(rowsToKeep);
    sheet.getRange(1, 1, newData.length, 4).setValues(newData);

    // ตัดแถวว่างส่วนเกินท้ายชีตออก เพื่อคืนโควตาเซลล์ของ Google Sheets สำหรับการใช้งาน 10+ ปี
    const bufferRows = 100;
    const maxRows = sheet.getMaxRows();
    if (maxRows > newData.length + bufferRows) {
      sheet.deleteRows(newData.length + bufferRows + 1, maxRows - (newData.length + bufferRows));
    }

    // บันทึกสถานะว่าสำรองปีนี้เรียบร้อยแล้ว
    PropertiesService.getScriptProperties().setProperty('ARCHIVED_YEAR_' + targetStationId + '_' + targetYear, 'DONE');

    Logger.log(
      'สำรองข้อมูลปี ' + targetYear + ' สำเร็จ (' + rowsToArchive.length + ' แถว) -> ' +
      verifiedFile.getName() + ' (URL: ' + verifiedFile.getUrl() + ')'
    );

    return {
      ok: true,
      archivedRows: rowsToArchive.length,
      keptRows: rowsToKeep.length,
      fileName: verifiedFile.getName(),
      fileUrl: verifiedFile.getUrl()
    };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateArchiveFolder_() {
  if (CONFIG.ARCHIVE.DRIVE_FOLDER_ID) {
    return DriveApp.getFolderById(CONFIG.ARCHIVE.DRIVE_FOLDER_ID);
  }
  const folders = DriveApp.getFoldersByName(CONFIG.ARCHIVE.FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(CONFIG.ARCHIVE.FOLDER_NAME);
}

function formatCsvRow_(cells) {
  return cells.map(function(cell) {
    const s = (cell === null || cell === undefined) ? '' : String(cell);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',');
}
