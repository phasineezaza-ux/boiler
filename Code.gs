/**
 * ============================================================================
 * Code.gs — Web App API (doGet) สำหรับส่งข้อมูลแรงดันไอน้ำเป็น JSON
 * ============================================================================
 * Endpoints:
 *   1) ?action=latest&token=YOUR_TOKEN
 *      -> ส่งข้อมูลแถวล่าสุดสำหรับแสดงในการ์ดสถานะปัจจุบัน
 *   2) ?action=history&from=YYYY-MM-DD&to=YYYY-MM-DD&token=YOUR_TOKEN
 *      -> ส่งข้อมูลช่วงวันที่ พร้อมสรุป min/avg/max, กราฟที่ลดจุดแล้ว, และตารางล่าสุด
 */

/**
 * ฟังก์ชันหลักที่ Google Apps Script เรียกเมื่อมี HTTP GET เข้ามา
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};

    // 1. ตรวจสอบรหัสผ่าน (token) ก่อนส่งข้อมูลทุกครั้ง
    const authResult = verifyToken_(params.token);
    if (!authResult.ok) {
      return jsonResponse_({
        ok: false,
        code: 'UNAUTHORIZED',
        message: authResult.message
      });
    }

    const action = String(params.action || 'latest').trim().toLowerCase();
    const stationId = String(params.station || 'boiler-main').trim();

    if (action === 'latest') {
      return jsonResponse_(handleLatestRequest_(stationId));
    }

    if (action === 'history') {
      return jsonResponse_(handleHistoryRequest_(params.from, params.to, stationId));
    }

    return jsonResponse_({
      ok: false,
      code: 'INVALID_ACTION',
      message: 'ไม่รองรับ action: ' + action + ' (ใช้ได้เฉพาะ latest หรือ history)'
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      code: 'SERVER_ERROR',
      message: err && err.message ? err.message : String(err)
    });
  }
}

/**
 * ตรวจสอบ token จาก URL เทียบกับ API_TOKEN ที่เก็บใน Script Properties
 */
function verifyToken_(providedToken) {
  const expectedToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expectedToken) {
    return {
      ok: false,
      message: 'ยังไม่ได้ตั้งค่า API_TOKEN ใน Script Properties (กรุณารัน setupScriptProperties ก่อน)'
    };
  }
  if (!providedToken || String(providedToken).trim() !== String(expectedToken).trim()) {
    return {
      ok: false,
      message: 'Token ไม่ถูกต้องหรือไม่ได้ระบุ'
    };
  }
  return { ok: true };
}

/**
 * จัดการคำขอ ?action=latest&station=...
 * อ่านเฉพาะแถวท้ายๆ ของชีตเพื่อความรวดเร็ว แม้ชีตจะมีข้อมูลหลายแสนแถว
 */
function handleLatestRequest_(stationId) {
  const station = resolveStationConfig_(stationId || 'boiler-main');
  if (!station.ok) {
    return station.errorResponse;
  }

  const now = new Date();
  const tailResult = readTailRows_(30, station.config);

  if (tailResult.rows.length === 0) {
    return {
      ok: true,
      endpoint: 'latest',
      stationId: station.id,
      stationName: station.name,
      serverTime: formatIsoBkk_(now),
      reading: null,
      ageSeconds: null,
      isStale: true,
      staleThresholdMinutes: CONFIG.THRESHOLDS.STALE_MINUTES,
      totalRows: 0,
      message: 'ยังไม่มีข้อมูลใน Google Sheet ของ ' + station.name
    };
  }

  // เลือกแถวที่มี timestamp ล่าสุด (ปกติคือแถวสุดท้าย แต่เผื่อกรณีเรียงลำดับสลับ)
  let latestParsed = null;
  for (let i = 0; i < tailResult.rows.length; i++) {
    const parsed = parseSheetRow_(tailResult.rows[i]);
    if (parsed.hasTimestamp) {
      if (!latestParsed || parsed.timestampMs >= latestParsed.timestampMs) {
        latestParsed = parsed;
      }
    }
  }

  // ถ้าแถวท้ายๆ อ่าน timestamp ไม่ได้เลย ให้เอาแถวสุดท้ายดิบๆ แจ้งผู้ใช้ตรงๆ
  if (!latestParsed) {
    const lastRaw = tailResult.rows[tailResult.rows.length - 1];
    return {
      ok: true,
      endpoint: 'latest',
      stationId: station.id,
      stationName: station.name,
      serverTime: formatIsoBkk_(now),
      reading: {
        timestamp: null,
        date: String(lastRaw[CONFIG.COLUMNS.DATE] || ''),
        time: String(lastRaw[CONFIG.COLUMNS.TIME] || ''),
        value: null,
        rawValue: String(lastRaw[CONFIG.COLUMNS.VALUE] || ''),
        unit: String(lastRaw[CONFIG.COLUMNS.UNIT] || 'Bar'),
        isValid: false,
        validationError: 'รูปแบบวัน/เวลาในแถวล่าสุดไม่ถูกต้อง'
      },
      ageSeconds: null,
      isStale: true,
      staleThresholdMinutes: CONFIG.THRESHOLDS.STALE_MINUTES,
      totalRows: tailResult.totalDataRows
    };
  }

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - latestParsed.timestampMs) / 1000));
  const isStale = ageSeconds > CONFIG.THRESHOLDS.STALE_MINUTES * 60;

  return {
    ok: true,
    endpoint: 'latest',
    stationId: station.id,
    stationName: station.name,
    serverTime: formatIsoBkk_(now),
    reading: {
      timestamp: formatIsoBkk_(new Date(latestParsed.timestampMs)),
      date: latestParsed.dateStr,
      time: latestParsed.timeStr,
      value: latestParsed.isValidValue ? latestParsed.value : null,
      rawValue: latestParsed.rawValue,
      unit: latestParsed.unit,
      isValid: latestParsed.isValidValue,
      validationError: latestParsed.validationError
    },
    ageSeconds: ageSeconds,
    isStale: isStale,
    staleThresholdMinutes: CONFIG.THRESHOLDS.STALE_MINUTES,
    totalRows: tailResult.totalDataRows
  };
}

/**
 * จัดการคำขอ ?action=history&from=YYYY-MM-DD&to=YYYY-MM-DD&station=...
 */
function handleHistoryRequest_(fromParam, toParam, stationId) {
  const station = resolveStationConfig_(stationId || 'boiler-main');
  if (!station.ok) {
    return station.errorResponse;
  }

  const tz = CONFIG.TIMEZONE;
  const now = new Date();
  const todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  const fromStr = fromParam ? String(fromParam).trim() : todayStr;
  const toStr = toParam ? String(toParam).trim() : todayStr;

  if (!isValidDateString_(fromStr) || !isValidDateString_(toStr)) {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD (เช่น 2026-11-25)'
    };
  }

  if (fromStr > toStr) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      message: 'วันที่เริ่มต้น (from) ต้องไม่มากกว่าวันที่สิ้นสุด (to)'
    };
  }

  const startMs = parseBkkDateTimeMs_(fromStr, '00:00:00');
  const endMs = parseBkkDateTimeMs_(toStr, '23:59:59');
  const allRows = readAllDataRows_(station.config);

  const filteredAll = [];
  const validRows = [];
  let invalidCount = 0;

  for (let i = 0; i < allRows.length; i++) {
    const parsed = parseSheetRow_(allRows[i]);
    if (!parsed.hasTimestamp) continue;
    if (parsed.timestampMs < startMs || parsed.timestampMs > endMs) continue;

    filteredAll.push(parsed);
    if (parsed.isValidValue) {
      validRows.push(parsed);
    } else {
      invalidCount++;
    }
  }

  // เรียงตามเวลาเก่า -> ใหม่
  filteredAll.sort(function(a, b) { return a.timestampMs - b.timestampMs; });
  validRows.sort(function(a, b) { return a.timestampMs - b.timestampMs; });

  // คำนวณสถิติรวมจากข้อมูลดิบทั้งหมด (ไม่คำนวณจากค่าที่ถูกยุบจุดแล้ว เพื่อความแม่นยำ)
  const summary = computeSummary_(validRows, invalidCount);

  // ลดจำนวนจุดสำหรับกราฟตามความยาวช่วงเวลา
  const downsampled = downsamplePoints_(validRows, fromStr, toStr);

  // ส่งแถวล่าสุดสำหรับตาราง (ใหม่สุดอยู่บน)
  const recentLogs = [];
  const limit = Math.min(CONFIG.HISTORY.RECENT_LOGS_LIMIT, filteredAll.length);
  for (let i = filteredAll.length - 1; i >= filteredAll.length - limit; i--) {
    const r = filteredAll[i];
    recentLogs.push({
      timestamp: formatIsoBkk_(new Date(r.timestampMs)),
      date: r.dateStr,
      time: r.timeStr,
      value: r.isValidValue ? r.value : null,
      rawValue: r.rawValue,
      unit: r.unit,
      isValid: r.isValidValue,
      validationError: r.validationError
    });
  }

  return {
    ok: true,
    endpoint: 'history',
    stationId: station.id,
    stationName: station.name,
    from: fromStr,
    to: toStr,
    serverTime: formatIsoBkk_(now),
    aggregation: downsampled.aggregation,
    bucketMinutes: downsampled.bucketMinutes,
    summary: summary,
    points: downsampled.points,
    recentLogs: recentLogs
  };
}

/**
 * คำนวณค่า Min / Avg / Max และจำนวนสถานะจากข้อมูลที่ถูกต้องทั้งหมด
 */
function computeSummary_(validRows, invalidCount) {
  if (validRows.length === 0) {
    return {
      validCount: 0,
      invalidCount: invalidCount,
      min: null,
      avg: null,
      max: null,
      normalCount: 0,
      warningCount: 0,
      alarmCount: 0,
      stopCount: 0
    };
  }

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let normalCount = 0;
  let warningCount = 0;
  let alarmCount = 0;
  let stopCount = 0;

  for (let i = 0; i < validRows.length; i++) {
    const v = validRows[i].value;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;

    if (v === CONFIG.THRESHOLDS.STOP_VALUE) {
      stopCount++;
    } else if (CONFIG.THRESHOLDS.HIGH_ALARM_ENABLED && v > CONFIG.THRESHOLDS.HIGH_ALARM_MAX) {
      alarmCount++;
    } else if (v >= CONFIG.THRESHOLDS.NORMAL_MIN) {
      normalCount++;
    } else if (v >= CONFIG.THRESHOLDS.WARNING_MIN) {
      warningCount++;
    } else {
      alarmCount++;
    }
  }

  return {
    validCount: validRows.length,
    invalidCount: invalidCount,
    min: round1_(min),
    avg: round2_(sum / validRows.length),
    max: round1_(max),
    normalCount: normalCount,
    warningCount: warningCount,
    alarmCount: alarmCount,
    stopCount: stopCount
  };
}

/**
 * ลดจำนวนจุดกราฟอัตโนมัติตามความกว้างของช่วงวัน (เพื่อให้กราฟโหลดไวและไม่อืด)
 */
function downsamplePoints_(validRows, fromStr, toStr) {
  if (validRows.length === 0) {
    return { aggregation: 'raw', bucketMinutes: 1, points: [] };
  }

  const startMs = parseBkkDateTimeMs_(fromStr, '00:00:00');
  const endMs = parseBkkDateTimeMs_(toStr, '23:59:59');
  const spanDays = Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));

  let bucketMinutes = 1;
  let aggregation = 'raw';

  if (spanDays <= 1 && validRows.length <= CONFIG.HISTORY.MAX_CHART_POINTS) {
    bucketMinutes = 1;
    aggregation = 'raw';
  } else if (spanDays <= 2) {
    bucketMinutes = 5;
    aggregation = '5m';
  } else if (spanDays <= 10) {
    bucketMinutes = 60;
    aggregation = 'hourly';
  } else if (spanDays <= 45) {
    bucketMinutes = 360; // ราย 6 ชั่วโมง (30 วัน = 120 จุด เห็นแนวโน้มชัดกว่าเฉลี่ยทั้งวัน)
    aggregation = '6h';
  } else {
    bucketMinutes = 1440; // รายวัน
    aggregation = 'daily';
  }

  if (bucketMinutes === 1) {
    const rawPoints = validRows.map(function(r) {
      return {
        timestamp: formatIsoBkk_(new Date(r.timestampMs)),
        value: r.value,
        min: r.value,
        max: r.value,
        count: 1
      };
    });
    return { aggregation: 'raw', bucketMinutes: 1, points: rawPoints };
  }

  // จัดกลุ่มลงถังเวลา (Time Bucketing)
  // ปรับให้ตรงเวลาไทย (+07:00) โดยชดเชย offset 7 ชม. ก่อนหาร
  const tzOffsetMs = 7 * 60 * 60 * 1000;
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = {};
  const bucketOrder = [];

  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i];
    const localMs = r.timestampMs + tzOffsetMs;
    const keyMs = Math.floor(localMs / bucketMs) * bucketMs - tzOffsetMs;

    if (!buckets[keyMs]) {
      buckets[keyMs] = { keyMs: keyMs, sum: 0, min: Infinity, max: -Infinity, count: 0 };
      bucketOrder.push(keyMs);
    }
    const b = buckets[keyMs];
    b.sum += r.value;
    if (r.value < b.min) b.min = r.value;
    if (r.value > b.max) b.max = r.value;
    b.count++;
  }

  const points = bucketOrder.map(function(keyMs) {
    const b = buckets[keyMs];
    return {
      timestamp: formatIsoBkk_(new Date(b.keyMs)),
      value: round2_(b.sum / b.count),
      min: round1_(b.min),
      max: round1_(b.max),
      count: b.count
    };
  });

  return { aggregation: aggregation, bucketMinutes: bucketMinutes, points: points };
}

// ============================================================================
// ส่วนอ่านข้อมูลจาก Google Sheet / Published CSV (รองรับหลายจุดติดตั้ง)
// ============================================================================

/**
 * แปลง stationId เป็นการตั้งค่าแหล่งข้อมูลของจุดนั้น และตรวจสอบว่าพร้อมใช้งานหรือไม่
 */
function resolveStationConfig_(stationId) {
  const stations = CONFIG.STATIONS || {};
  const st = stations[stationId];

  if (!st || !st.enabled) {
    return {
      ok: false,
      errorResponse: {
        ok: false,
        code: 'UNKNOWN_STATION',
        stationId: stationId,
        message: 'ไม่พบจุดติดตั้งชื่อ "' + stationId + '" หรือยังไม่เปิดใช้งาน'
      }
    };
  }

  const mode = st.dataSourceMode || CONFIG.DATA_SOURCE_MODE;
  const publishedCsvUrl = st.publishedCsvUrl || (stationId === 'boiler-main' ? CONFIG.PUBLISHED_CSV_URL : '');
  const spreadsheetId = st.spreadsheetId || CONFIG.SPREADSHEET_ID || '';
  const sheetName = st.sheetName || (stationId === 'boiler-main' ? CONFIG.SHEET_NAME : '');

  if (mode === 'PUBLISHED_CSV' && !publishedCsvUrl) {
    return {
      ok: false,
      errorResponse: {
        ok: false,
        code: 'STATION_NOT_CONFIGURED',
        stationId: stationId,
        stationName: st.name,
        message: 'ยังไม่ได้ใส่ลิงก์ pub?output=csv ของ "' + st.name + '" ใน Config.gs (STATIONS["' + stationId + '"].publishedCsvUrl)'
      }
    };
  }

  if (mode === 'SPREADSHEET' && stationId !== 'boiler-main' && !sheetName && !st.spreadsheetId) {
    return {
      ok: false,
      errorResponse: {
        ok: false,
        code: 'STATION_NOT_CONFIGURED',
        stationId: stationId,
        stationName: st.name,
        message: 'ยังไม่ได้ระบุ sheetName หรือ spreadsheetId ของ "' + st.name + '" ใน Config.gs'
      }
    };
  }

  return {
    ok: true,
    id: stationId,
    name: st.name,
    config: {
      id: stationId,
      name: st.name,
      mode: mode,
      publishedCsvUrl: publishedCsvUrl,
      spreadsheetId: spreadsheetId,
      sheetName: sheetName
    }
  };
}

/**
 * คืนรายการ stationId ทั้งหมดที่มีการตั้งค่าแหล่งข้อมูลพร้อมใช้งานแล้ว (สำหรับ LINE / Archive)
 */
function getConfiguredStationIds_() {
  const stations = CONFIG.STATIONS || {};
  return Object.keys(stations).filter(function(id) {
    return resolveStationConfig_(id).ok;
  });
}

function getTargetSheet_(stationCfg) {
  const cfg = stationCfg || resolveStationConfig_('boiler-main').config;
  const ss = cfg.spreadsheetId
    ? SpreadsheetApp.openById(cfg.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('ไม่พบ Spreadsheet (กรุณาผูก Script กับชีต หรือระบุ SPREADSHEET_ID ใน Config.gs)');
  }

  const sheet = cfg.sheetName ? ss.getSheetByName(cfg.sheetName) : ss.getSheets()[0];
  if (!sheet) {
    throw new Error('ไม่พบแท็บชีตชื่อ: ' + cfg.sheetName);
  }
  return sheet;
}

/**
 * อ่านแถวท้ายๆ สำหรับ latest endpoint (ประหยัดเวลาและ RAM เมื่อชีตโตขึ้น)
 */
function readTailRows_(tailCount, stationCfg) {
  const cfg = stationCfg || resolveStationConfig_('boiler-main').config;

  if (cfg.mode === 'PUBLISHED_CSV') {
    const all = readAllDataRows_(cfg);
    const start = Math.max(0, all.length - tailCount);
    return {
      rows: all.slice(start),
      totalDataRows: all.length
    };
  }

  const sheet = getTargetSheet_(cfg);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { rows: [], totalDataRows: 0 };
  }

  const totalDataRows = lastRow - 1;
  const count = Math.min(tailCount, totalDataRows);
  const startRow = lastRow - count + 1;
  const rows = sheet.getRange(startRow, 1, count, 4).getValues();
  return { rows: rows, totalDataRows: totalDataRows };
}

/**
 * อ่านแถวข้อมูลทั้งหมด (ไม่รวม Header แถว 1)
 */
function readAllDataRows_(stationCfg) {
  const cfg = stationCfg || resolveStationConfig_('boiler-main').config;

  if (cfg.mode === 'PUBLISHED_CSV') {
    const resp = UrlFetchApp.fetch(cfg.publishedCsvUrl, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      throw new Error('ไม่สามารถดึง Published CSV ของ ' + cfg.name + ' ได้ (HTTP ' + resp.getResponseCode() + ')');
    }
    const parsedCsv = Utilities.parseCsv(resp.getContentText('UTF-8'));
    if (parsedCsv.length <= 1) return [];
    return parsedCsv.slice(1).filter(function(row) {
      return row.some(function(cell) { return String(cell || '').trim() !== ''; });
    });
  }

  const sheet = getTargetSheet_(cfg);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 4).getValues();
}

// ============================================================================
// ส่วนตรวจสอบและแปลงชนิดข้อมูล (Strict Data Validation)
// ============================================================================

/**
 * แปลง 1 แถวจากชีตเป็นออบเจ็กต์ที่มีการตรวจสอบชนิดข้อมูลอย่างเข้มงวด
 * - รองรับทั้ง Date object (จาก Google Sheets) และ String (จาก CSV/PLC)
 * - ไม่เดาค่าถ้าอ่านค่าไม่ได้ จะส่ง isValidValue = false กลับไปตรงๆ
 */
function parseSheetRow_(row) {
  const rawDate = row[CONFIG.COLUMNS.DATE];
  const rawTime = row[CONFIG.COLUMNS.TIME];
  const rawVal = row[CONFIG.COLUMNS.VALUE];
  const rawUnit = row[CONFIG.COLUMNS.UNIT];

  const dateStr = normalizeDateCell_(rawDate);
  const timeStr = normalizeTimeCell_(rawTime);
  const timestampMs = (dateStr && timeStr) ? parseBkkDateTimeMs_(dateStr, timeStr) : NaN;
  const hasTimestamp = !isNaN(timestampMs);

  const unit = (rawUnit !== null && rawUnit !== undefined && String(rawUnit).trim() !== '')
    ? String(rawUnit).trim()
    : 'Bar';

  const valCheck = validatePressureValue_(rawVal);

  return {
    hasTimestamp: hasTimestamp,
    timestampMs: timestampMs,
    dateStr: dateStr || String(rawDate || ''),
    timeStr: timeStr || String(rawTime || ''),
    value: valCheck.value,
    rawValue: valCheck.rawString,
    unit: unit,
    isValidValue: valCheck.isValid,
    validationError: valCheck.error
  };
}

function validatePressureValue_(rawVal) {
  if (rawVal === null || rawVal === undefined) {
    return { isValid: false, value: null, rawString: '', error: 'ค่าแรงดันว่างเปล่า' };
  }
  if (typeof rawVal === 'boolean') {
    return { isValid: false, value: null, rawString: String(rawVal), error: 'ชนิดข้อมูลเป็น Boolean ไม่ใช่ตัวเลข' };
  }

  const rawString = String(rawVal).trim();
  if (rawString === '') {
    return { isValid: false, value: null, rawString: '', error: 'ค่าแรงดันว่างเปล่า' };
  }

  const num = Number(rawString);
  if (!isFinite(num) || isNaN(num)) {
    return { isValid: false, value: null, rawString: rawString, error: 'ค่าไม่ใช่ตัวเลข: "' + rawString + '"' };
  }
  if (num < 0) {
    return { isValid: false, value: null, rawString: rawString, error: 'ค่าแรงดันติดลบ (' + num + ')' };
  }

  return {
    isValid: true,
    value: round1_(num),
    rawString: rawString,
    error: null
  };
}

function normalizeDateCell_(rawDate) {
  if (rawDate === null || rawDate === undefined || rawDate === '') return null;

  if (Object.prototype.toString.call(rawDate) === '[object Date]' && !isNaN(rawDate.getTime())) {
    return Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  const s = String(rawDate).trim();
  // YYYY-MM-DD หรือ YYYY/MM/DD
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) {
    return m[1] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[3]));
  }
  // DD/MM/YYYY หรือ DD-MM-YYYY
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year > 2400) year -= 543; // เผื่อกรอกปี พ.ศ.
    return year + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[1]));
  }
  return null;
}

function normalizeTimeCell_(rawTime) {
  if (rawTime === null || rawTime === undefined || rawTime === '') return null;

  if (Object.prototype.toString.call(rawTime) === '[object Date]' && !isNaN(rawTime.getTime())) {
    return Utilities.formatDate(rawTime, CONFIG.TIMEZONE, 'HH:mm:ss');
  }

  const s = String(rawTime).trim();
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = m[3] ? Number(m[3]) : 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59) {
      return pad2_(hh) + ':' + pad2_(mm) + ':' + pad2_(ss);
    }
  }
  return null;
}

function parseBkkDateTimeMs_(dateStr, timeStr) {
  // สร้างเวลาแบบระบุ +07:00 ชัดเจน ไม่ขึ้นกับ timezone เครื่องรัน
  const iso = dateStr + 'T' + timeStr + '+07:00';
  return new Date(iso).getTime();
}

function isValidDateString_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function formatIsoBkk_(dateObj) {
  return Utilities.formatDate(dateObj, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
