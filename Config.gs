/**
 * ============================================================================
 * Config.gs — ไฟล์ตั้งค่ากลางสำหรับ Google Apps Script (Backend)
 * ระบบติดตามแรงดันไอน้ำ Boiler (Boiler Pressure Monitor)
 * ============================================================================
 * หมายเหตุสำหรับผู้ดูแล:
 * - ค่าเกณฑ์แรงดันทั้งหมดของฝั่ง Backend ถูกเก็บไว้ในไฟล์นี้ไฟล์เดียว
 * - ส่วนรหัสผ่านลับ (API_TOKEN, LINE_CHANNEL_ACCESS_TOKEN, LINE_RECIPIENT_IDS)
 *   ห้ามใส่ในไฟล์นี้! ให้ตั้งค่าผ่าน Script Properties (ดูไฟล์ SetupProperties.gs)
 */

const CONFIG = {
  // --------------------------------------------------------------------------
  // 1. แหล่งข้อมูล Google Sheet
  // --------------------------------------------------------------------------
  // โหมด 'PUBLISHED_CSV'   = อ่านจากลิงก์ Publish CSV ด้านล่างโดยตรง (พร้อมทดสอบทันที ไม่ต้องแก้ชีต)
  // โหมด 'SPREADSHEET'     = อ่านจาก Google Sheet โดยตรง (แนะนำเมื่อขึ้นระบบจริง + ต้องใช้สำหรับสำรองข้อมูลรายปี)
  DATA_SOURCE_MODE: 'PUBLISHED_CSV',

  // ใช้เมื่อ DATA_SOURCE_MODE = 'SPREADSHEET':
  // ถ้าสร้าง Apps Script ผูกกับชีตโดยตรง (Extensions -> Apps Script) ให้เว้นว่าง '' ได้เลย
  // ถ้าสร้างเป็น Standalone Script ให้ใส่ Spreadsheet ID (ข้อความหลัง /d/ ใน URL ชีต)
  SPREADSHEET_ID: '',

  // ชื่อแท็บ (Sheet Tab) ที่เก็บข้อมูล เช่น 'Sheet1' (เว้นว่าง '' = ใช้แท็บแรก)
  SHEET_NAME: '',

  // ใช้เมื่อ DATA_SOURCE_MODE = 'PUBLISHED_CSV':
  // ลิงก์ CSV เริ่มต้นของ Boiler (เมนหลัก)
  PUBLISHED_CSV_URL:
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vSPyPs8CAQldU9A82lqUg9SVKZ3Gz3I60Zrspw95rkMN4YAv4ffHyKLTqOmBdSmyQ/pub?output=csv',

  // --------------------------------------------------------------------------
  // 1.1 รายชื่อจุดติดตั้งทั้งหมด (Boiler เมนหลัก + Line 1–4)
  // --------------------------------------------------------------------------
  // วิธีต่อข้อมูล Line 1–4:
  //   - ถ้าใช้โหมด 'PUBLISHED_CSV': วางลิงก์ pub?output=csv ของแต่ละ Line ใน publishedCsvUrl
  //   - ถ้าใช้โหมด 'SPREADSHEET': ใส่ชื่อแท็บใน sheetName (ถ้าอยู่คนละแท็บในไฟล์เดียวกัน)
  //     หรือใส่ spreadsheetId + sheetName (ถ้าอยู่คนละไฟล์ Google Sheet)
  STATIONS: {
    'boiler-main': {
      name: 'Boiler (เมนหลัก)',
      enabled: true,
      spreadsheetId: '',
      sheetName: '',
      publishedCsvUrl:
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vSPyPs8CAQldU9A82lqUg9SVKZ3Gz3I60Zrspw95rkMN4YAv4ffHyKLTqOmBdSmyQ/pub?output=csv'
    },
    'line-1': {
      name: 'Line 1',
      enabled: true,
      spreadsheetId: '',
      sheetName: '',
      publishedCsvUrl: ''
    },
    'line-2': {
      name: 'Line 2',
      enabled: true,
      spreadsheetId: '',
      sheetName: '',
      publishedCsvUrl: ''
    },
    'line-3': {
      name: 'Line 3',
      enabled: true,
      spreadsheetId: '',
      sheetName: '',
      publishedCsvUrl: ''
    },
    'line-4': {
      name: 'Line 4',
      enabled: true,
      spreadsheetId: '',
      sheetName: '',
      publishedCsvUrl: ''
    }
  },

  TIMEZONE: 'Asia/Bangkok',

  // โครงสร้างคอลัมน์ (แถวที่ 1 เป็น Header)
  COLUMNS: {
    DATE: 0,  // คอลัมน์ A: Date
    TIME: 1,  // คอลัมน์ B: Time
    VALUE: 2, // คอลัมน์ C: Value
    UNIT: 3   // คอลัมน์ D: Unit
  },

  // --------------------------------------------------------------------------
  // 2. เกณฑ์แรงดันไอน้ำ (Bar) — ต้องตั้งให้ตรงกับฝั่งหน้าเว็บ (web/config.js)
  // --------------------------------------------------------------------------
  THRESHOLDS: {
    // ปกติ (Normal): >= 7.6 Bar (รวมค่า 7.6 พอดีด้วย)
    NORMAL_MIN: 7.6,

    // เตือนระยะแรก (Warning): 7.1 ถึง < 7.6 Bar (เช่น 7.1 - 7.5)
    WARNING_MIN: 7.1,

    // หยุดเดินเครื่อง (Machine Stop): ค่า = 0 (ไม่ถือเป็น Error)
    STOP_VALUE: 0,

    // เกณฑ์แรงดันสูงเกินกำหนด (High Pressure Alarm) — ยังไม่ตกลงกับเจ้าของงาน
    // เปิด/ปิดได้ที่ HIGH_ALARM_ENABLED (true / false)
    HIGH_ALARM_ENABLED: false,
    HIGH_ALARM_MAX: 10.0,

    // ระยะเวลาที่ถือว่า "ขาดการติดต่อ" (นาที)
    STALE_MINUTES: 3
  },

  // --------------------------------------------------------------------------
  // 3. การตั้งค่าการดึงข้อมูลย้อนหลัง (History Endpoint)
  // --------------------------------------------------------------------------
  HISTORY: {
    // จำนวนจุดสูงสุดที่ส่งให้กราฟ เพื่อไม่ให้หน้าเว็บช้าเมื่อเลือกช่วงยาว
    MAX_CHART_POINTS: 360,
    // จำนวนแถวล่าสุดที่ส่งกลับสำหรับตารางบันทึกในหน้าเว็บ
    RECENT_LOGS_LIMIT: 60
  },

  // --------------------------------------------------------------------------
  // 4. การตั้งค่าระบบแจ้งเตือน LINE Official Account (ฟรี 300 ข้อความ/เดือน)
  // --------------------------------------------------------------------------
  LINE: {
    // โควตารวมสูงสุดต่อเดือนของแพ็กเกจฟรี LINE OA
    MONTHLY_LIMIT: 300,
    // แบ่งครึ่งสำหรับสรุปรายวัน (5 คน x 30 วัน = 150)
    DAILY_SUMMARY_BUDGET: 150,
    // แบ่งครึ่งสำหรับแจ้งเตือนฉุกเฉิน (< 7.1 หรือขาดการติดต่อ)
    EMERGENCY_BUDGET: 150,

    // Hysteresis: ค่าต้องฟื้นตัวขึ้นมาถึง >= 7.2 Bar จึงจะรีเซ็ตสถานะ Alarm
    // ป้องกันการส่งข้อความซ้ำรัวเมื่อค่าแกว่งแถว 7.0 <-> 7.1
    HYSTERESIS_RECOVERY_BAR: 7.2,

    // ช่วงเวลาขั้นต่ำ (นาที) ก่อนจะส่งแจ้งเตือนเหตุการณ์ใหม่ หากสถานะแกว่งหรือหยุด-เดินถี่
    ALERT_COOLDOWN_MINUTES: 30,

    // ส่งข้อความแจ้งเมื่อค่ากลับสู่ปกติหรือไม่ (false เพื่อประหยัดโควตา)
    SEND_RECOVERY_MESSAGE: false,

    // ชื่อจุดติดตั้งสำหรับแสดงในข้อความ LINE
    STATION_NAME: 'Boiler (เมนหลัก)'
  },

  // --------------------------------------------------------------------------
  // 5. การตั้งค่าสำรองข้อมูลรายปี (Yearly Archive)
  // --------------------------------------------------------------------------
  ARCHIVE: {
    // Folder ID ใน Google Drive (ถ้าเว้นว่าง '' ระบบจะสร้างโฟลเดอร์ชื่อ FOLDER_NAME ให้อัตโนมัติ)
    DRIVE_FOLDER_ID: '',
    FOLDER_NAME: 'Boiler_Pressure_Archives',
    FILE_PREFIX: 'Boiler_Pressure_Archive_'
  }
};
