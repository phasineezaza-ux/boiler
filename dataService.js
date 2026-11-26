/**
 * ============================================================================
 * dataService.js — ส่วนดึงข้อมูลจาก Google Apps Script (และโหมดทดสอบ 30 แถว)
 * ============================================================================
 * แยกส่วนการสื่อสารกับ API ออกจากตรรกะเกณฑ์และหน้าจอ
 * หากในอนาคตย้ายแหล่งข้อมูลจาก Google Sheet ไปเป็นฐานข้อมูลอื่น
 * สามารถแก้ไขเฉพาะไฟล์นี้ไฟล์เดียวได้เลย
 */

(function (global) {
  'use strict';

  const STORAGE_KEY_URL = 'boiler_monitor_webapp_url';
  const STORAGE_KEY_TOKEN = 'boiler_monitor_api_token';
  const STORAGE_KEY_FORCE_DEMO = 'boiler_monitor_force_demo';

  // ชุดข้อมูลตัวอย่าง 30 แถว (ตรงกับไฟล์ sample-data/boiler_sample_30rows.csv)
  // ใช้เฉพาะเมื่อยังไม่ได้ตั้งค่า Web App URL หรือเปิดโหมดทดสอบ
  const SAMPLE_30_ROWS = [
    { offsetMin: 29, value: 8.0 },
    { offsetMin: 28, value: 7.9 },
    { offsetMin: 27, value: 7.8 },
    { offsetMin: 26, value: 7.7 },
    { offsetMin: 25, value: 7.6 },
    { offsetMin: 24, value: 7.6 },
    { offsetMin: 23, value: 7.5 },
    { offsetMin: 22, value: 7.4 },
    { offsetMin: 21, value: 7.3 },
    { offsetMin: 20, value: 7.2 },
    { offsetMin: 19, value: 7.1 },
    { offsetMin: 18, value: 7.0 },
    { offsetMin: 17, value: 6.9 },
    { offsetMin: 16, value: 6.8 },
    { offsetMin: 15, value: 6.7 },
    { offsetMin: 14, value: 6.9 },
    { offsetMin: 13, value: 0 },
    { offsetMin: 12, value: 0 },
    { offsetMin: 11, value: 0 },
    { offsetMin: 10, value: 0 },
    { offsetMin: 9, value: 7.1 },
    { offsetMin: 8, value: 7.2 },
    { offsetMin: 7, value: 7.3 },
    { offsetMin: 6, value: 7.4 },
    { offsetMin: 5, value: 7.5 },
    { offsetMin: 4, value: 7.6 },
    { offsetMin: 3, value: 7.7 },
    { offsetMin: 2, value: 7.8 },
    { offsetMin: 1, value: 7.9 },
    { offsetMin: 0, value: 8.1 }
  ];

  /**
   * อ่านค่าการเชื่อมต่อปัจจุบัน (รวมค่าที่ผู้ใช้บันทึกไว้ในเบราว์เซอร์กับ config.js)
   */
  function getConnectionSettings() {
    const cfg = global.BOILER_CONFIG.api;
    const savedUrl = (safeStorageGet(STORAGE_KEY_URL) || '').trim();
    const savedToken = (safeStorageGet(STORAGE_KEY_TOKEN) || '').trim();
    const forceDemo = safeStorageGet(STORAGE_KEY_FORCE_DEMO) === 'true';

    const webAppUrl = savedUrl || (cfg.webAppUrl || '').trim();
    const token = savedToken || (cfg.token || '').trim();
    const isConfigured = Boolean(webAppUrl && token);

    return {
      webAppUrl: webAppUrl,
      token: token,
      isConfigured: isConfigured,
      isDemoMode: forceDemo || (!isConfigured && cfg.allowDemoFallback)
    };
  }

  function saveConnectionSettings(webAppUrl, token, forceDemo) {
    safeStorageSet(STORAGE_KEY_URL, (webAppUrl || '').trim());
    safeStorageSet(STORAGE_KEY_TOKEN, (token || '').trim());
    safeStorageSet(STORAGE_KEY_FORCE_DEMO, forceDemo ? 'true' : 'false');
  }

  function clearSavedConnectionSettings() {
    try {
      global.localStorage.removeItem(STORAGE_KEY_URL);
      global.localStorage.removeItem(STORAGE_KEY_TOKEN);
      global.localStorage.removeItem(STORAGE_KEY_FORCE_DEMO);
    } catch (_) {
      // ข้ามถ้าเบราว์เซอร์ปิด localStorage
    }
  }

  /**
   * ดึงข้อมูลล่าสุด (latest endpoint)
   */
  async function fetchLatest(stationId, demoScenario) {
    const conn = getConnectionSettings();
    if (conn.isDemoMode) {
      return buildDemoLatest(stationId, demoScenario || 'normal');
    }
    if (!conn.isConfigured) {
      throw new Error('ยังไม่ได้ตั้งค่า Web App URL และ Token ใน config.js หรือเมนูตั้งค่า');
    }

    const url = buildApiUrl(conn.webAppUrl, {
      action: 'latest',
      station: stationId,
      token: conn.token
    });

    const data = await fetchJsonWithTimeout(url, global.BOILER_CONFIG.api.requestTimeoutMs);
    if (!data || data.ok !== true) {
      throw new Error((data && data.message) || 'ไม่สามารถอ่านข้อมูลล่าสุดจาก Apps Script ได้');
    }
    return data;
  }

  /**
   * ดึงข้อมูลย้อนหลัง (history endpoint)
   */
  async function fetchHistory(stationId, fromDate, toDate) {
    const conn = getConnectionSettings();
    if (conn.isDemoMode) {
      return buildDemoHistory(stationId, fromDate, toDate);
    }
    if (!conn.isConfigured) {
      throw new Error('ยังไม่ได้ตั้งค่า Web App URL และ Token ใน config.js หรือเมนูตั้งค่า');
    }

    const url = buildApiUrl(conn.webAppUrl, {
      action: 'history',
      station: stationId,
      from: fromDate,
      to: toDate,
      token: conn.token
    });

    const data = await fetchJsonWithTimeout(url, global.BOILER_CONFIG.api.requestTimeoutMs);
    if (!data || data.ok !== true) {
      throw new Error((data && data.message) || 'ไม่สามารถดึงข้อมูลย้อนหลังจาก Apps Script ได้');
    }
    return data;
  }

  function buildApiUrl(baseUrl, params) {
    const sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
    const qs = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    return baseUrl + sep + qs;
  }

  /**
   * เรียก fetch() แบบไม่ส่ง custom headers เพื่อหลีกเลี่ยง CORS Preflight (OPTIONS)
   * ที่ Google Apps Script Web App ไม่รองรับ
   */
  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(function () { controller.abort(); }, timeoutMs || 15000)
      : null;

    try {
      const resp = await fetch(url, {
        method: 'GET',
        signal: controller ? controller.signal : undefined
      });
      if (!resp.ok) {
        throw new Error('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + resp.status + ')');
      }
      return await resp.json();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('หมดเวลาเชื่อมต่อ Google Apps Script (Timeout)');
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ==========================================================================
  // ส่วนสร้างข้อมูลโหมดทดสอบ (Demo Mode) จากชุดตัวอย่าง 30 แถว
  // ==========================================================================

  function getStationName(stationId) {
    const stations = global.BOILER_CONFIG.stations || [];
    const found = stations.find(function (s) { return s.id === stationId; });
    return found ? found.name : 'Boiler (เมนหลัก)';
  }

  function getDemoStationOffset(stationId) {
    const offsets = {
      'boiler-main': 0,
      'line-1': -0.2,
      'line-2': -0.4,
      'line-3': -0.1,
      'line-4': -0.5
    };
    return typeof offsets[stationId] === 'number' ? offsets[stationId] : 0;
  }

  function buildDemoLatest(stationId, scenario) {
    const now = new Date();
    const offset = getDemoStationOffset(stationId);
    let sampleTime = new Date(now.getTime() - 25 * 1000); // 25 วินาทีที่แล้ว
    let numVal = Math.round((7.8 + offset) * 10) / 10;
    let rawVal = String(numVal);
    let isValid = true;
    let validationError = null;
    let isStale = false;

    if (scenario === 'warning') {
      rawVal = '7.3';
      numVal = 7.3;
    } else if (scenario === 'alarm') {
      rawVal = '6.8';
      numVal = 6.8;
    } else if (scenario === 'stop') {
      rawVal = '0';
      numVal = 0;
    } else if (scenario === 'stale') {
      sampleTime = new Date(now.getTime() - 6 * 60 * 1000); // 6 นาทีที่แล้ว (> 3 นาที)
      rawVal = '7.8';
      numVal = 7.8;
      isStale = true;
    } else if (scenario === 'invalid') {
      rawVal = 'ERR_SENSOR';
      numVal = null;
      isValid = false;
      validationError = 'ค่าไม่ใช่ตัวเลข ("ERR_SENSOR")';
    }

    const parts = toBkkDateTimeParts(sampleTime);
    const ageSeconds = Math.floor((now.getTime() - sampleTime.getTime()) / 1000);

    return {
      ok: true,
      isDemo: true,
      endpoint: 'latest',
      stationId: stationId || 'boiler-main',
      stationName: getStationName(stationId),
      serverTime: formatIsoLocal(now),
      reading: {
        timestamp: formatIsoLocal(sampleTime),
        date: parts.date,
        time: parts.time,
        value: numVal,
        rawValue: rawVal,
        unit: 'Bar',
        isValid: isValid,
        validationError: validationError
      },
      ageSeconds: ageSeconds,
      isStale: isStale,
      staleThresholdMinutes: global.BOILER_CONFIG.thresholds.staleMinutes,
      totalRows: 30
    };
  }

  function buildDemoHistory(stationId, fromDateStr, toDateStr) {
    const now = new Date();
    const offset = getDemoStationOffset(stationId);
    const fromDate = parseDateOnly(fromDateStr) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const toDate = parseDateOnly(toDateStr) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const spanDays = Math.max(1, Math.round((toDate - fromDate) / (24 * 60 * 60 * 1000)) + 1);

    // ถ้าเลือกช่วง 1 วัน (24 ชม.) ให้แสดงชุดข้อมูลตัวอย่าง 30 แถวโดยตรง
    if (spanDays <= 1) {
      const baseMs = now.getTime();
      const rows = SAMPLE_30_ROWS.map(function (item) {
        const dt = new Date(baseMs - item.offsetMin * 60 * 1000);
        const parts = toBkkDateTimeParts(dt);
        const val = item.value === 0 ? 0 : Math.max(0.1, Math.round((item.value + offset) * 10) / 10);
        return {
          timestamp: formatIsoLocal(dt),
          date: parts.date,
          time: parts.time,
          value: val,
          rawValue: String(val),
          unit: 'Bar',
          isValid: true,
          validationError: null,
          min: val,
          max: val,
          count: 1
        };
      });

      const summary = computeSummary(rows);
      return {
        ok: true,
        isDemo: true,
        endpoint: 'history',
        stationId: stationId,
        from: fromDateStr,
        to: toDateStr,
        aggregation: 'raw',
        bucketMinutes: 1,
        summary: summary,
        points: rows,
        recentLogs: rows.slice().reverse()
      };
    }

    // ถ้าทดสอบ 7 วัน / 30 วัน ในโหมดทดสอบ สร้างข้อมูลตัวอย่างหลายวันพร้อมยุบจุดให้เหมือน API จริง
    const bucketHours = spanDays <= 7 ? 2 : 6;
    const points = [];
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0);
    const endLimit = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59);
    let idx = 0;

    while (cursor <= endLimit && cursor <= now) {
      const sample = SAMPLE_30_ROWS[idx % SAMPLE_30_ROWS.length];
      const v = sample.value === 0 ? 7.4 : sample.value;
      const minV = Math.max(0, Math.round((v - 0.3) * 10) / 10);
      const maxV = Math.round((v + 0.2) * 10) / 10;
      const parts = toBkkDateTimeParts(cursor);
      points.push({
        timestamp: formatIsoLocal(cursor),
        date: parts.date,
        time: parts.time,
        value: v,
        rawValue: String(v),
        unit: 'Bar',
        isValid: true,
        min: minV,
        max: maxV,
        count: bucketHours * 60
      });
      cursor.setHours(cursor.getHours() + bucketHours);
      idx++;
    }

    const summary = computeSummary(points);
    return {
      ok: true,
      isDemo: true,
      endpoint: 'history',
      stationId: stationId,
      from: fromDateStr,
      to: toDateStr,
      aggregation: spanDays <= 7 ? '2h' : '6h',
      bucketMinutes: bucketHours * 60,
      summary: summary,
      points: points,
      recentLogs: points.slice(-30).reverse()
    };
  }

  function computeSummary(rows) {
    if (!rows.length) {
      return { validCount: 0, invalidCount: 0, min: null, avg: null, max: null };
    }
    const th = global.BOILER_CONFIG.thresholds;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let normalCount = 0;
    let warningCount = 0;
    let alarmCount = 0;
    let stopCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const v = rows[i].value;
      const rMin = typeof rows[i].min === 'number' ? rows[i].min : v;
      const rMax = typeof rows[i].max === 'number' ? rows[i].max : v;
      if (rMin < min) min = rMin;
      if (rMax > max) max = rMax;
      sum += v;

      if (v === th.stopValue) stopCount++;
      else if (v >= th.normalMin) normalCount++;
      else if (v >= th.warningMin) warningCount++;
      else alarmCount++;
    }

    return {
      validCount: rows.length,
      invalidCount: 0,
      min: Math.round(min * 10) / 10,
      avg: Math.round((sum / rows.length) * 100) / 100,
      max: Math.round(max * 10) / 10,
      normalCount: normalCount,
      warningCount: warningCount,
      alarmCount: alarmCount,
      stopCount: stopCount
    };
  }

  function parseDateOnly(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function toBkkDateTimeParts(d) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return {
      date: yyyy + '-' + mm + '-' + dd,
      time: hh + ':' + mi + ':' + ss
    };
  }

  function formatIsoLocal(d) {
    const p = toBkkDateTimeParts(d);
    return p.date + 'T' + p.time + '+07:00';
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function safeStorageGet(k) {
    try { return global.localStorage.getItem(k); } catch (_) { return null; }
  }

  function safeStorageSet(k, v) {
    try { global.localStorage.setItem(k, v); } catch (_) { /* ignore */ }
  }

  global.BoilerDataService = {
    getConnectionSettings: getConnectionSettings,
    saveConnectionSettings: saveConnectionSettings,
    clearSavedConnectionSettings: clearSavedConnectionSettings,
    fetchLatest: fetchLatest,
    fetchHistory: fetchHistory
  };
})(window);
