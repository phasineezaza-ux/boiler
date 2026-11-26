/**
 * ============================================================================
 * SetupProperties.gs — เครื่องมือช่วยตั้งค่าสำหรับผู้ดูแล (รันครั้งแรกครั้งเดียว)
 * ============================================================================
 * วิธีใช้:
 *   1. แก้ค่าตัวอย่างใน setupScriptProperties() ให้เป็นค่าจริงของคุณ
 *   2. ในตัวแก้ไข Apps Script เลือกฟังก์ชัน setupScriptProperties แล้วกด Run
 *   3. (สำคัญ) หลังรันเสร็จ ให้ลบรหัสจริงออกจากไฟล์นี้ เพื่อไม่ให้ค้างในโค้ด
 *   4. เลือกฟังก์ชัน installAllTriggers แล้วกด Run เพื่อให้ระบบแจ้งเตือนและสำรองข้อมูลทำงานอัตโนมัติ
 */

/**
 * ตั้งค่ารหัสลับทั้งหมดไว้ใน Script Properties (ปลอดภัย ไม่หลุดไปหน้าเว็บ)
 */
function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    // รหัสผ่านสำหรับ URL เว็บแอป เช่น ?action=latest&token=BOILER-SECRET-2026
    // แนะนำให้ตั้งเป็นตัวอักษรผสมตัวเลขยาว 16+ ตัวอักษร
    API_TOKEN: 'CHANGE-THIS-TO-YOUR-SECRET-TOKEN',

    // Channel Access Token จาก LINE Developers (Messaging API)
    LINE_CHANNEL_ACCESS_TOKEN: 'PASTE-YOUR-LINE-CHANNEL-ACCESS-TOKEN',

    // LINE User ID ของผู้รับสูงสุด 5 คน คั่นด้วยเครื่องหมายจุลภาค (,)
    // ตัวอย่าง: 'U1234567890abcdef1234567890abcdef,Uabcdef1234567890abcdef1234567890'
    LINE_RECIPIENT_IDS: 'PASTE-USER-ID-1,PASTE-USER-ID-2'
  });

  Logger.log('บันทึก Script Properties เรียบร้อยแล้ว');
}

/**
 * ติดตั้ง Time-driven Triggers อัตโนมัติทั้ง 3 ตัว
 * (จะลบ Trigger ชื่อซ้ำของโปรเจกต์นี้ก่อน เพื่อไม่ให้ทำงานซ้ำซ้อน)
 */
function installAllTriggers() {
  const managedHandlers = [
    'checkAndNotifyBoilerStatus',
    'sendDailySummary',
    'runAnnualArchiveIfJanuary'
  ];

  const existing = ScriptApp.getProjectTriggers();
  for (let i = 0; i < existing.length; i++) {
    if (managedHandlers.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  // 1) เช็กสถานะแรงดันเพื่อส่ง LINE ฉุกเฉินทุก 1 นาที
  //    หมายเหตุ: ถ้าต้องการประหยัดโควตา runtime ของ Apps Script สามารถเปลี่ยนเป็น .everyMinutes(5) ได้
  ScriptApp.newTrigger('checkAndNotifyBoilerStatus')
    .timeBased()
    .everyMinutes(1)
    .create();

  // 2) ส่งสรุปรายวันทาง LINE วันละ 1 ครั้ง ช่วง 18:00 - 19:00 น.
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  // 3) ตรวจสอบขึ้นปีใหม่ทุกวันที่ 1 ของเดือน เวลา 01:00 - 02:00 น. (ทำงานจริงเฉพาะเดือน ม.ค.)
  ScriptApp.newTrigger('runAnnualArchiveIfJanuary')
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  Logger.log('ติดตั้ง Triggers ทั้ง 3 ตัวสำเร็จแล้ว');
}

/**
 * ใช้ทดสอบส่งข้อความเข้า LINE หลังตั้งค่า Script Properties เสร็จ
 */
function testLineNotification() {
  const result = sendLineWithQuota_(
    'emergency',
    '🔔 ทดสอบการเชื่อมต่อ LINE แจ้งเตือนระบบ Boiler Pressure Monitor สำเร็จ!'
  );
  Logger.log('ผลทดสอบ LINE: ' + JSON.stringify(result));
}

/**
 * ใช้ดูสถานะโควตา LINE เดือนปัจจุบันใน Execution Log
 */
function checkLineQuotaStatus() {
  Logger.log(JSON.stringify(getMonthlyQuotaStatus_(), null, 2));
}
