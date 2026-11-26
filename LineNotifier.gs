/**
 * ============================================================================
 * LineNotifier.gs — ระบบแจ้งเตือนผ่าน LINE Official Account (โควตาฟรี 300/เดือน)
 * ============================================================================
 * แบ่งโควตา 300 ข้อความ/เดือน:
 *   - 150 ข้อความ: สรุปรายวันตอนเย็น วันละ 1 ครั้ง ถึงผู้เกี่ยวข้องสูงสุด 5 คน (5 x 30 = 150)
 *   - 150 ข้อความ: แจ้งเตือนฉุกเฉินทันที เมื่อเข้าเกณฑ์ Alarm (< 7.1) หรือขาดการติดต่อ (> 3 นาที)
 *
 * การป้องกันส่งซ้ำรัว (Anti-spam & Hysteresis):
 *   - แจ้งเตือน 1 ครั้งต่อเหตุการณ์ (จำสถานะล่าสุดไว้ใน Script Properties)
 *   - ใช้ Hysteresis (7.2 Bar) และ Cooldown (30 นาที) ไม่ส่งรัวเมื่อค่าแกว่งแถว 7.1
 *   - นับจำนวนข้อความที่ส่งไปจริง (คูณตามจำนวนผู้รับ) และหยุดส่งเมื่อใกล้ถึงโควตา
 */

/**
 * ฟังก์ชันนี้ตั้ง Trigger ให้รันอัตโนมัติทุก 1 นาที (หรือทุก 5 นาที)
 * ตรวจสอบทุกจุดติดตั้งที่มีการตั้งค่าลิงก์/ชีตไว้แล้ว (Boiler + Line 1–4)
 */
function checkAndNotifyBoilerStatus() {
  const stationIds = getConfiguredStationIds_();
  for (let i = 0; i < stationIds.length; i++) {
    checkSingleStationAndNotify_(stationIds[i]);
  }
}

function checkSingleStationAndNotify_(stationId) {
  const latest = handleLatestRequest_(stationId);
  const props = PropertiesService.getScriptProperties();
  const nowMs = Date.now();
  const suffix = '_' + stationId;

  const stateKey = 'BOILER_ALERT_STATE' + suffix;
  const typeKey = 'BOILER_LAST_EMERGENCY_TYPE' + suffix;
  const timeKey = 'BOILER_LAST_ALERT_MS' + suffix;

  const currentState = evaluateLineAlertState_(latest);
  const prevState = props.getProperty(stateKey) || 'NORMAL';
  const lastEmergencyType = props.getProperty(typeKey) || '';
  const lastAlertMs = Number(props.getProperty(timeKey) || '0');
  const cooldownMs = CONFIG.LINE.ALERT_COOLDOWN_MINUTES * 60 * 1000;
  const stationName = latest.stationName || stationId;

  // กรณีที่ 1: เข้าสู่ภาวะฉุกเฉิน (ALARM_LOW, ALARM_HIGH, DISCONNECTED, INVALID)
  if (isEmergencyState_(currentState.code)) {
    const isSameOngoingIncident = (prevState === currentState.code);
    const inCooldownSameType = (lastEmergencyType === currentState.code) && ((nowMs - lastAlertMs) < cooldownMs);

    // ส่งแจ้งเตือนเฉพาะเมื่อเป็นเหตุการณ์ใหม่ และไม่ซ้ำชนิดเดิมในช่วง Cooldown
    if (!isSameOngoingIncident && !inCooldownSameType) {
      const msg = buildEmergencyMessage_(latest, currentState);
      const sent = sendLineWithQuota_('emergency', msg);
      if (sent.ok) {
        const updates = {};
        updates[timeKey] = String(nowMs);
        updates[typeKey] = currentState.code;
        props.setProperties(updates);
      }
    }
    props.setProperty(stateKey, currentState.code);
    return;
  }

  // กรณีที่ 2: กำลังอยู่ในช่วง Hysteresis (เคย Alarm < 7.1 แล้วตอนนี้เด้งมา 7.1 - 7.19)
  // ยังไม่รีเซ็ตสถานะ Alarm เพื่อป้องกันส่งซ้ำถ้าตกลงไป 7.0 อีกในนาทีถัดไป
  if (prevState === 'ALARM_LOW' &&
      latest.reading &&
      latest.reading.isValid &&
      latest.reading.value > 0 &&
      latest.reading.value < CONFIG.LINE.HYSTERESIS_RECOVERY_BAR) {
    return; // คงสถานะเดิมไว้ก่อน
  }

  // กรณีที่ 3: ฟื้นตัวกลับสู่ภาวะปกติ / เตือน / หยุดเครื่อง
  if (isEmergencyState_(prevState)) {
    if (CONFIG.LINE.SEND_RECOVERY_MESSAGE && currentState.code === 'NORMAL') {
      const msg =
        '✅ [กลับสู่ภาวะปกติ]\n' +
        'จุดวัด: ' + stationName + '\n' +
        'แรงดันปัจจุบัน: ' + latest.reading.value.toFixed(1) + ' Bar\n' +
        'เวลา: ' + latest.reading.date + ' ' + latest.reading.time;
      sendLineWithQuota_('emergency', msg);
    }
  }

  props.setProperty(stateKey, currentState.code);
}

/**
 * ฟังก์ชันนี้ตั้ง Trigger ให้รันวันละ 1 ครั้ง ตอนเย็น (เช่น 18:00 - 19:00 น.)
 * รวมสรุปทุกจุดติดตั้งที่ต่อใช้งานอยู่ส่งในข้อความเดียว (เพื่อประหยัดโควตา LINE)
 */
function sendDailySummary() {
  const tz = CONFIG.TIMEZONE;
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const stationIds = getConfiguredStationIds_();
  const quota = getMonthlyQuotaStatus_();

  const msgLines = [
    '📊 สรุปรายวันแรงดันไอน้ำ',
    'วันที่: ' + todayStr
  ];

  for (let i = 0; i < stationIds.length; i++) {
    const id = stationIds[i];
    const history = handleHistoryRequest_(todayStr, todayStr, id);
    const latest = handleLatestRequest_(id);
    if (!history.ok) continue;

    const s = history.summary;
    const stationName = history.stationName || id;
    let currentLine = 'ขาดการติดต่อ (> ' + CONFIG.THRESHOLDS.STALE_MINUTES + ' นาที)';
    if (!latest.isStale && latest.reading && latest.reading.isValid) {
      const val = latest.reading.value;
      currentLine = val.toFixed(1) + ' Bar (' + (val === 0 ? 'หยุดเดิน' : evaluateLineAlertState_(latest).label) + ')';
    } else if (!latest.isStale && latest.reading && !latest.reading.isValid) {
      currentLine = 'อ่านค่าไม่ได้ (' + (latest.reading.validationError || 'ข้อมูลผิดพลาด') + ')';
    }

    msgLines.push('━━━━━━━━━━━━━━');
    msgLines.push('📍 ' + stationName);
    msgLines.push('• ล่าสุด: ' + currentLine);
    msgLines.push(
      '• Min/Avg/Max: ' +
      (s.min !== null ? s.min.toFixed(1) : '-') + ' / ' +
      (s.avg !== null ? s.avg.toFixed(2) : '-') + ' / ' +
      (s.max !== null ? s.max.toFixed(1) : '-') + ' Bar'
    );
    msgLines.push(
      '• นาที (ปกติ/เตือน/ตก/หยุด): ' +
      s.normalCount + '/' + s.warningCount + '/' + s.alarmCount + '/' + s.stopCount
    );
  }

  msgLines.push('━━━━━━━━━━━━━━');
  msgLines.push('โควตา LINE เดือนนี้ใช้แล้ว: ' + quota.totalSent + '/' + CONFIG.LINE.MONTHLY_LIMIT + ' ข้อความ');

  sendLineWithQuota_('summary', msgLines.join('\n'));
}

/**
 * แปลงผลจาก latest เป็นสถานะสำหรับตัดสินใจส่งแจ้งเตือน LINE
 */
function evaluateLineAlertState_(latest) {
  if (!latest || !latest.ok || !latest.reading) {
    return { code: 'DISCONNECTED', label: 'ไม่มีข้อมูล / ขาดการติดต่อ' };
  }
  if (latest.isStale) {
    return { code: 'DISCONNECTED', label: 'ขาดการติดต่อ (> ' + CONFIG.THRESHOLDS.STALE_MINUTES + ' นาที)' };
  }
  if (!latest.reading.isValid) {
    return { code: 'INVALID', label: 'ข้อมูลผิดพลาด / อ่านค่าไม่ได้' };
  }

  const v = latest.reading.value;
  if (v === CONFIG.THRESHOLDS.STOP_VALUE) {
    return { code: 'STOP', label: 'หยุดเดิน (หยุดผลิต)' };
  }
  if (CONFIG.THRESHOLDS.HIGH_ALARM_ENABLED && v > CONFIG.THRESHOLDS.HIGH_ALARM_MAX) {
    return { code: 'ALARM_HIGH', label: 'แรงดันสูงเกินกำหนด' };
  }
  if (v >= CONFIG.THRESHOLDS.NORMAL_MIN) {
    return { code: 'NORMAL', label: 'ปกติ' };
  }
  if (v >= CONFIG.THRESHOLDS.WARNING_MIN) {
    return { code: 'WARNING', label: 'เตือนระยะแรก' };
  }
  return { code: 'ALARM_LOW', label: 'แรงดันตก (Alarm)' };
}

function isEmergencyState_(code) {
  return code === 'ALARM_LOW' || code === 'ALARM_HIGH' || code === 'DISCONNECTED' || code === 'INVALID';
}

function buildEmergencyMessage_(latest, state) {
  const stationName = (latest && latest.stationName) ? latest.stationName : CONFIG.LINE.STATION_NAME;

  if (state.code === 'DISCONNECTED') {
    const lastSeen = (latest.reading && latest.reading.date)
      ? (latest.reading.date + ' ' + latest.reading.time)
      : 'ไม่พบข้อมูลล่าสุด';
    const ageMin = latest.ageSeconds !== null ? Math.floor(latest.ageSeconds / 60) : '-';
    return [
      '🚨 [แจ้งเตือนฉุกเฉิน: ขาดการติดต่อ]',
      'จุดวัด: ' + stationName,
      'สาเหตุ: ไม่ได้รับข้อมูลใหม่เกิน ' + CONFIG.THRESHOLDS.STALE_MINUTES + ' นาที',
      'ข้อมูลล่าสุดเมื่อ: ' + lastSeen + ' (ผ่านมา ' + ageMin + ' นาที)',
      'กรุณาตรวจสอบ PLC / IoT Gateway และอินเทอร์เน็ต'
    ].join('\n');
  }

  if (state.code === 'INVALID') {
    return [
      '⚠️ [แจ้งเตือน: อ่านค่าเซนเซอร์ไม่ได้]',
      'จุดวัด: ' + stationName,
      'สาเหตุ: ' + (latest.reading.validationError || 'ข้อมูลผิดรูปแบบ'),
      'ค่าดิบที่ได้รับ: "' + latest.reading.rawValue + '"',
      'เวลา: ' + latest.reading.date + ' ' + latest.reading.time
    ].join('\n');
  }

  const icon = state.code === 'ALARM_HIGH' ? '🔥' : '🚨';
  return [
    icon + ' [แจ้งเตือนฉุกเฉิน: ' + state.label + ']',
    'จุดวัด: ' + stationName,
    'ค่าแรงดัน: ' + latest.reading.value.toFixed(1) + ' ' + latest.reading.unit,
    'เกณฑ์ปกติ: >= ' + CONFIG.THRESHOLDS.NORMAL_MIN.toFixed(1) + ' Bar',
    'เวลาบันทึก: ' + latest.reading.date + ' ' + latest.reading.time
  ].join('\n');
}

/**
 * ส่งข้อความผ่าน LINE Messaging API (Multicast) พร้อมตรวจสอบและนับโควตา
 * @param {'emergency'|'summary'} category ประเภทข้อความเพื่อแยกนับโควตา 150 / 150
 * @param {string} messageText ข้อความที่จะส่ง
 */
function sendLineWithQuota_(category, messageText) {
  const props = PropertiesService.getScriptProperties();
  const accessToken = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const recipientsRaw = props.getProperty('LINE_RECIPIENT_IDS') || '';

  const userIds = recipientsRaw
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s.length > 0; });

  if (!accessToken || userIds.length === 0) {
    Logger.log('ข้ามการส่ง LINE: ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_RECIPIENT_IDS ใน Script Properties');
    return { ok: false, reason: 'MISSING_LINE_CREDENTIALS' };
  }

  const quota = getMonthlyQuotaStatus_();
  const cost = userIds.length; // LINE OA นับ 1 ข้อความต่อผู้รับ 1 คน

  // ตรวจโควตาแยกรายหมวด (150 emergency / 150 summary) และโควตารวม (300)
  if (quota.totalSent + cost > CONFIG.LINE.MONTHLY_LIMIT) {
    Logger.log('หยุดส่ง LINE: โควตารวมเดือนนี้เต็มแล้ว (' + quota.totalSent + '/' + CONFIG.LINE.MONTHLY_LIMIT + ')');
    return { ok: false, reason: 'MONTHLY_LIMIT_REACHED' };
  }
  if (category === 'emergency' && quota.emergencySent + cost > CONFIG.LINE.EMERGENCY_BUDGET) {
    Logger.log('หยุดส่ง LINE ฉุกเฉิน: เกินงบส่วนฉุกเฉิน 150 ข้อความ/เดือน (' + quota.emergencySent + ')');
    return { ok: false, reason: 'EMERGENCY_BUDGET_REACHED' };
  }
  if (category === 'summary' && quota.summarySent + cost > CONFIG.LINE.DAILY_SUMMARY_BUDGET) {
    Logger.log('หยุดส่ง LINE สรุปรายวัน: เกินงบส่วนสรุป 150 ข้อความ/เดือน (' + quota.summarySent + ')');
    return { ok: false, reason: 'SUMMARY_BUDGET_REACHED' };
  }

  // ถ้าเหลือโควตาน้อย (เช่น เหลือ < 15 ข้อความ) แทรกคำเตือนท้ายข้อความ
  const remainingAfter = CONFIG.LINE.MONTHLY_LIMIT - (quota.totalSent + cost);
  let finalText = messageText;
  if (remainingAfter <= 15) {
    finalText += '\n\n⚠️ หมายเหตุ: โควตา LINE เดือนนี้เหลือ ' + remainingAfter + ' ข้อความ';
  }

  const url = 'https://api.line.me/v2/bot/message/multicast';
  const payload = {
    to: userIds,
    messages: [{ type: 'text', text: finalText }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    incrementMonthlyQuota_(category, cost);
    Logger.log('ส่ง LINE สำเร็จ (' + category + ', +' + cost + ' ข้อความ)');
    return { ok: true, sentCount: cost };
  }

  Logger.log('ส่ง LINE ไม่สำเร็จ HTTP ' + code + ': ' + resp.getContentText());
  return { ok: false, reason: 'HTTP_' + code, detail: resp.getContentText() };
}

/**
 * อ่านและรีเซ็ตตัวนับโควตาอัตโนมัติเมื่อขึ้นเดือนใหม่
 */
function getMonthlyQuotaStatus_() {
  const props = PropertiesService.getScriptProperties();
  const currentMonth = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM');
  const savedMonth = props.getProperty('LINE_QUOTA_MONTH');

  if (savedMonth !== currentMonth) {
    props.setProperties({
      LINE_QUOTA_MONTH: currentMonth,
      LINE_QUOTA_TOTAL: '0',
      LINE_QUOTA_EMERGENCY: '0',
      LINE_QUOTA_SUMMARY: '0'
    });
    return { month: currentMonth, totalSent: 0, emergencySent: 0, summarySent: 0 };
  }

  return {
    month: currentMonth,
    totalSent: Number(props.getProperty('LINE_QUOTA_TOTAL') || '0'),
    emergencySent: Number(props.getProperty('LINE_QUOTA_EMERGENCY') || '0'),
    summarySent: Number(props.getProperty('LINE_QUOTA_SUMMARY') || '0')
  };
}

function incrementMonthlyQuota_(category, cost) {
  const props = PropertiesService.getScriptProperties();
  const status = getMonthlyQuotaStatus_();
  const newTotal = status.totalSent + cost;
  const updates = { LINE_QUOTA_TOTAL: String(newTotal) };

  if (category === 'emergency') {
    updates.LINE_QUOTA_EMERGENCY = String(status.emergencySent + cost);
  } else {
    updates.LINE_QUOTA_SUMMARY = String(status.summarySent + cost);
  }
  props.setProperties(updates);
}
