/**
 * ============================================================================
 * pressureEvaluator.js — ตรรกะการตรวจสอบความถูกต้องของข้อมูลและประเมินสถานะ
 * ============================================================================
 * แยกออกจากส่วนดึงข้อมูล (dataService) และส่วนหน้าจอ (UI) โดยสมบูรณ์
 * ไม่มีโค้ด DOM หรือ fetch() อยู่ในไฟล์นี้ ทำให้ง่ายต่อการทดสอบและนำไปใช้ซ้ำ
 */

(function (global) {
  'use strict';

  /**
   * ตรวจสอบชนิดข้อมูลของค่าแรงดันอย่างเข้มงวด
   * ป้องกันกับดักของ JavaScript เช่น Number("") === 0 หรือ Number(null) === 0
   * @param {unknown} rawValue ค่าดิบที่รับเข้ามา
   * @returns {{ isValid: boolean, value: number|null, error: string|null }}
   */
  function parseStrictPressure(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return { isValid: false, value: null, error: 'ไม่มีค่าแรงดัน (ค่าว่าง)' };
    }
    if (typeof rawValue === 'boolean') {
      return { isValid: false, value: null, error: 'รูปแบบข้อมูลไม่ถูกต้อง (Boolean)' };
    }

    const str = String(rawValue).trim();
    if (str === '') {
      return { isValid: false, value: null, error: 'ค่าแรงดันว่างเปล่า' };
    }

    const num = Number(str);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      return { isValid: false, value: null, error: 'ค่าไม่ใช่ตัวเลข ("' + str + '")' };
    }
    if (num < 0) {
      return { isValid: false, value: null, error: 'ค่าแรงดันติดลบ (' + num + ') ผิดปกติ' };
    }

    return {
      isValid: true,
      value: Math.round(num * 10) / 10,
      error: null
    };
  }

  /**
   * ประเมินสถานะของค่าแรงดัน 1 จุด (ใช้ได้ทั้งค่าปัจจุบันและแถวในตารางย้อนหลัง)
   * @param {unknown} rawValue
   * @param {object} thresholds ออบเจ็กต์ thresholds จาก config.js
   */
  function evaluatePressureValue(rawValue, thresholds) {
    const parsed = parseStrictPressure(rawValue);
    if (!parsed.isValid) {
      return {
        code: 'INVALID',
        label: 'อ่านค่าไม่ได้',
        shortLabel: 'ผิดพลาด',
        description: parsed.error || 'ข้อมูลจากเซนเซอร์ผิดรูปแบบ',
        colorClass: 'status-invalid',
        value: null,
        isValid: false
      };
    }

    const v = parsed.value;

    // 1. กรณีเครื่องหยุดเดิน (ค่า = 0) -> สีเทา แสดงว่า "หยุดผลิต" ไม่ใช่ Error
    if (v === thresholds.stopValue) {
      return {
        code: 'STOP',
        label: 'เครื่องหยุดเดิน (หยุดผลิต)',
        shortLabel: 'หยุดเดิน',
        description: 'ค่าแรงดัน 0.0 Bar — Boiler หยุดผลิตตามปกติ ไม่ใช่เซนเซอร์เสีย',
        colorClass: 'status-stop',
        value: v,
        isValid: true
      };
    }

    // 2. กรณีเปิดใช้งานเกณฑ์แรงดันสูงเกินกำหนด (High Pressure Alarm)
    if (thresholds.highAlarm && thresholds.highAlarm.enabled && v > thresholds.highAlarm.maxBar) {
      return {
        code: 'ALARM_HIGH',
        label: 'แรงดันสูงเกินกำหนด',
        shortLabel: 'แรงดันสูง',
        description: 'แรงดันสูงกว่าค่าสูงสุดที่ตั้งไว้ (' + thresholds.highAlarm.maxBar.toFixed(1) + ' Bar)',
        colorClass: 'status-alarm',
        value: v,
        isValid: true
      };
    }

    // 3. Normal (ปกติ): >= 7.6 Bar (รวม 7.6 พอดี) -> สีเขียว
    if (v >= thresholds.normalMin) {
      return {
        code: 'NORMAL',
        label: 'ปกติ (Normal)',
        shortLabel: 'ปกติ',
        description: 'แรงดันไอน้ำอยู่ในช่วงพร้อมจ่ายงาน (>= ' + thresholds.normalMin.toFixed(1) + ' Bar)',
        colorClass: 'status-normal',
        value: v,
        isValid: true
      };
    }

    // 4. Warning (เตือนระยะแรก): 7.1 ถึง < 7.6 Bar -> สีเหลือง
    if (v >= thresholds.warningMin) {
      return {
        code: 'WARNING',
        label: 'เตือนระยะแรก (Warning)',
        shortLabel: 'เฝ้าระวัง',
        description: 'แรงดันเริ่มลดลง (' + thresholds.warningMin.toFixed(1) + ' – < ' + thresholds.normalMin.toFixed(1) + ' Bar) ควรตรวจสอบ',
        colorClass: 'status-warning',
        value: v,
        isValid: true
      };
    }

    // 5. Alarm (แรงดันตก): < 7.1 Bar -> สีแดง
    return {
      code: 'ALARM_LOW',
      label: 'แรงดันตก (Alarm)',
      shortLabel: 'แรงดันตก',
      description: 'แรงดันต่ำกว่า ' + thresholds.warningMin.toFixed(1) + ' Bar กรุณาตรวจสอบ Boiler ทันที',
      colorClass: 'status-alarm',
      value: v,
      isValid: true
    };
  }

  /**
   * ประเมินสถานะสำหรับการ์ด "แรงดันปัจจุบัน" (รวมการตรวจข้อมูลค้าง/ขาดการติดต่อ > 3 นาที)
   * สำคัญ: ถ้าข้อมูลเก่ากว่า 3 นาที จะไม่แสดงค่าเก่าเป็นค่าปัจจุบันเด็ดขาด
   */
  function evaluateLatestReading(latestPayload, thresholds, nowMs) {
    const currentNowMs = typeof nowMs === 'number' ? nowMs : Date.now();
    const staleLimitSec = (thresholds.staleMinutes || 3) * 60;

    if (!latestPayload || !latestPayload.reading) {
      return {
        code: 'DISCONNECTED',
        label: 'ขาดการติดต่อ',
        shortLabel: 'ขาดการติดต่อ',
        description: 'ไม่พบข้อมูลล่าสุดจาก Google Sheet กรุณาตรวจสอบการเชื่อมต่อ',
        colorClass: 'status-disconnected',
        displayValue: '--',
        unit: 'Bar',
        showAsCurrentValue: false,
        ageSeconds: null,
        lastTimestamp: null,
        isStale: true
      };
    }

    const reading = latestPayload.reading;
    const parsedTs = reading.timestamp ? Date.parse(reading.timestamp) : NaN;
    let ageSeconds = null;

    if (!Number.isNaN(parsedTs)) {
      ageSeconds = Math.max(0, Math.floor((currentNowMs - parsedTs) / 1000));
    } else if (typeof latestPayload.ageSeconds === 'number') {
      ageSeconds = Math.max(0, latestPayload.ageSeconds);
    }

    const isStale = Boolean(latestPayload.isStale) ||
      ageSeconds === null ||
      ageSeconds > staleLimitSec;

    // กรณีข้อมูลเก่ากว่า 3 นาที -> ขาดการติดต่อ (ห้ามแสดงค่าเก่าเป็นค่าปัจจุบัน)
    if (isStale) {
      const ageMinText = ageSeconds !== null ? formatDurationThai(ageSeconds) : 'ไม่ทราบระยะเวลา';
      return {
        code: 'DISCONNECTED',
        label: 'ขาดการติดต่อ',
        shortLabel: 'ขาดการติดต่อ',
        description:
          'ไม่ได้รับข้อมูลใหม่นานเกิน ' + thresholds.staleMinutes + ' นาที (ข้อมูลล่าสุดผ่านมาแล้ว ' + ageMinText + ') — ค่าด้านล่างไม่ใช่ค่าปัจจุบัน',
        colorClass: 'status-disconnected',
        displayValue: '--',
        unit: reading.unit || 'Bar',
        showAsCurrentValue: false,
        ageSeconds: ageSeconds,
        lastTimestamp: reading.timestamp || null,
        lastKnownValue: reading.isValid ? reading.value : null,
        isStale: true
      };
    }

    // กรณีข้อมูลยังใหม่ แต่ค่าอ่านไม่ได้ / ผิดรูปแบบ -> แจ้งตรงๆ ห้ามเดา
    if (!reading.isValid) {
      return {
        code: 'INVALID',
        label: 'อ่านค่าไม่ได้ (ข้อมูลผิดพลาด)',
        shortLabel: 'อ่านค่าไม่ได้',
        description: reading.validationError || 'ข้อมูลในแถวล่าสุดไม่ใช่ตัวเลขที่ถูกต้อง',
        colorClass: 'status-invalid',
        displayValue: 'N/A',
        unit: reading.unit || 'Bar',
        showAsCurrentValue: false,
        ageSeconds: ageSeconds,
        lastTimestamp: reading.timestamp || null,
        isStale: false
      };
    }

    // ข้อมูลใหม่และถูกต้อง -> ประเมินเกณฑ์แรงดัน
    const evalResult = evaluatePressureValue(reading.value, thresholds);
    return {
      code: evalResult.code,
      label: evalResult.label,
      shortLabel: evalResult.shortLabel,
      description: evalResult.description,
      colorClass: evalResult.colorClass,
      displayValue: evalResult.value !== null ? evalResult.value.toFixed(1) : 'N/A',
      numericValue: evalResult.value,
      unit: reading.unit || 'Bar',
      showAsCurrentValue: evalResult.isValid,
      ageSeconds: ageSeconds,
      lastTimestamp: reading.timestamp || null,
      isStale: false
    };
  }

  /**
   * แปลงจำนวนวินาทีเป็นข้อความภาษาไทยที่อ่านง่าย
   */
  function formatDurationThai(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) {
      return '-';
    }
    if (totalSeconds < 60) {
      return totalSeconds + ' วินาที';
    }
    const mins = Math.floor(totalSeconds / 60);
    if (mins < 60) {
      return mins + ' นาที';
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) {
      return hours + ' ชม. ' + (remMins > 0 ? remMins + ' นาที' : '');
    }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return days + ' วัน ' + (remHours > 0 ? remHours + ' ชม.' : '');
  }

  global.BoilerEvaluator = {
    parseStrictPressure: parseStrictPressure,
    evaluatePressureValue: evaluatePressureValue,
    evaluateLatestReading: evaluateLatestReading,
    formatDurationThai: formatDurationThai
  };
})(window);
