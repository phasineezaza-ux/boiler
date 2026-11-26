# คู่มือติดตั้งทีละขั้น (สำหรับมือใหม่) — ระบบติดตามแรงดันไอน้ำ (Boiler Pressure Monitor)

คู่มือนี้เขียนเป็นลำดับขั้นตอนสำหรับผู้ดูแลที่เป็นนักศึกษาหรือเริ่มต้นใช้งานครั้งแรก สามารถทำตามตั้งแต่ 0 จนเปิดใช้งานจริงบนมือถือและคอมพิวเตอร์ได้ครบทั้งระบบ

---

## ภาพรวมโครงสร้างไฟล์ในโปรเจกต์

| โฟลเดอร์ / ไฟล์ | หน้าที่ |
|---|---|
| `apps-script/Config.gs` | ตั้งค่าแหล่งข้อมูล, เกณฑ์แรงดัน, โควตา LINE, และโฟลเดอร์สำรองข้อมูล |
| `apps-script/Code.gs` | Web App API (`latest` และ `history`) ส่ง JSON พร้อมตรวจ `token` |
| `apps-script/LineNotifier.gs` | ระบบเช็กเกณฑ์แจ้งเตือนฉุกเฉิน LINE + สรุปรายวัน + นับโควตา 300 ข้อความ/เดือน |
| `apps-script/YearlyArchive.gs` | สำรองข้อมูลปีเก่าเป็น CSV ลง Google Drive แล้วตรวจไฟล์ก่อนลบออกจากชีต |
| `apps-script/SetupProperties.gs` | ฟังก์ชันช่วยบันทึกรหัสลับและติดตั้ง Trigger อัตโนมัติ |
| `apps-script/appsscript.json` | ไฟล์ตั้งค่า Timezone (`Asia/Bangkok`) และสิทธิ์ Web App |
| `web/` | โค้ดหน้าเว็บ (HTML/CSS/JS) แก้เกณฑ์และลิงก์ได้ที่ `web/config.js` ไฟล์เดียว |
| `sample-data/boiler_sample_30rows.csv` | ข้อมูลตัวอย่าง 30 แถว (คละค่า `>7.6`, `7.1–7.5`, `<7.1`, `0`) สำหรับทดสอบ |

---

## ขั้นตอนที่ 1: เตรียม Google Sheet และทดสอบด้วยข้อมูลตัวอย่าง 30 แถว

1. เข้า [Google Sheets](https://sheets.google.com) แล้วสร้างชีตใหม่ (หรือเปิดชีตจริงที่ PLC / Gateway บันทึกอยู่)
2. ตรวจสอบให้แน่ใจว่าแถวที่ 1 เป็นหัวตารางตรงตามนี้ (A1:D1):
   - `A1`: `Date`
   - `B1`: `Time`
   - `C1`: `Value`
   - `D1`: `Unit`
3. **หากต้องการทดสอบก่อนต่อเครื่องจริง**:
   - ใน Google Sheet ไปที่เมนู **File (ไฟล์) -> Import (นำเข้า) -> Upload (อัปโหลด)**
   - เลือกไฟล์ `sample-data/boiler_sample_30rows.csv`
   - เลือก **Replace current sheet** หรือ **Append to current sheet**
4. **ข้อแนะนำเรื่องการตั้งสิทธิ์แชร์ชีตและโหมดอ่านข้อมูล (สำคัญมาก)**:
   - ค่าเริ่มต้นใน `Config.gs` ตั้งเป็น `DATA_SOURCE_MODE: 'PUBLISHED_CSV'` โดยใส่ลิงก์ `pub?output=csv` ของคุณไว้ให้แล้ว ทำให้วางโค้ดใน `script.google.com` แล้วทดสอบอ่านข้อมูลได้ทันทีโดยไม่ต้องมีสิทธิ์แก้ไขชีต
   - **เมื่อขึ้นใช้งานจริงระยะยาว (และต้องการให้ `YearlyArchive.gs` สำรองและล้างชีตอัตโนมัติ)** ให้เปลี่ยนเป็น `DATA_SOURCE_MODE: 'SPREADSHEET'` ซึ่ง **ไม่จำเป็นต้องเปิดชีตเป็นสาธารณะ (Public)** สามารถตั้งสิทธิ์ชีตเป็น **Restricted (จำกัดเฉพาะบัญชีเจ้าของชีตและบัญชีของ Gateway ที่ใช้เขียนข้อมูล)** ได้เลย เพื่อความปลอดภัย

---

## ขั้นตอนที่ 2: สร้างและวางโค้ด Google Apps Script

1. เปิด Google Sheet ของคุณ แล้วคลิกเมนู **Extensions (ส่วนขยาย) -> Apps Script**
2. เปิดหน้าต่าง **Project Settings (ไอคอนรูปเฟืองด้านซ้าย)**:
   - ติ๊กถูกที่ช่อง **Show "appsscript.json" manifest file in editor**
   - ตรวจสอบ **Time zone** ให้เป็น `(GMT+07:00) Bangkok`
3. กลับมาที่เมนู **Editor (ไอคอน `</>`)**:
   - เปิดไฟล์ `appsscript.json` แล้วนำเนื้อหาจาก `apps-script/appsscript.json` มาวางทับ
   - กดเครื่องหมาย `+` ข้างคำว่า Files -> เลือก **Script** เพื่อสร้างไฟล์ใหม่ทีละไฟล์ให้ชื่อตรงกัน (ไม่ต้องพิมพ์นามสกุล `.gs`):
     1. `Config` (คัดลอกจาก `apps-script/Config.gs`)
     2. `Code` (แก้ไขไฟล์ `Code.gs` เดิมโดยวางโค้ดจาก `apps-script/Code.gs`)
     3. `LineNotifier` (คัดลอกจาก `apps-script/LineNotifier.gs`)
     4. `YearlyArchive` (คัดลอกจาก `apps-script/YearlyArchive.gs`)
     5. `SetupProperties` (คัดลอกจาก `apps-script/SetupProperties.gs`)
4. กดปุ่ม **Save (Ctrl+S)** เพื่อบันทึกทุกไฟล์

---

## ขั้นตอนที่ 3: เตรียม LINE Official Account (สำหรับแจ้งเตือนฟรี 300 ข้อความ/เดือน)

1. สมัครและสร้าง LINE Official Account ฟรีที่ [LINE Official Account Manager](https://manager.line.biz/)
2. เปิดใช้งาน **Messaging API** (Settings -> Messaging API -> Enable Messaging API)
3. เข้า [LINE Developers Console](https://developers.line.biz/console/) เลือก Provider และ Channel ของคุณ:
   - ไปที่แท็บ **Messaging API**
   - เลื่อนลงไปล่างสุดที่หัวข้อ **Channel access token (long-lived)** -> กด **Issue** แล้วคัดลอก Token เก็บไว้
4. **หา LINE User ID ของผู้รับ (สูงสุด 5 คน)**:
   - ให้ผู้รับทั้ง 5 คนแอดเพื่อน LINE OA ของระบบ
   - สามารถดู User ID (ขึ้นต้นด้วยตัว `U` ยาว 33 ตัวอักษร เช่น `U1234abcd...`) ได้จากการต่อ Webhook ชั่วคราว หรือดูในหน้า Log เมื่อผู้ใช้ส่งข้อความทักบอท (หมายเหตุ: แพ็กเกจฟรีนับ 1 ข้อความต่อผู้รับ 1 คน ดังนั้นส่งสรุป 1 ครั้งให้ 5 คน = ใช้โควตา 5 ข้อความ)

---

## ขั้นตอนที่ 4: ตั้งค่ารหัสลับ (Script Properties) และติดตั้ง Trigger อัตโนมัติ

1. เปิดไฟล์ `SetupProperties.gs` ใน Apps Script
2. แก้ไขข้อมูลในฟังก์ชัน `setupScriptProperties()`:
   - `API_TOKEN`: ตั้งรหัสผ่านเองสำหรับเว็บแอป เช่น `Boiler2026!SecretKey`
   - `LINE_CHANNEL_ACCESS_TOKEN`: วาง Token จาก LINE Developers
   - `LINE_RECIPIENT_IDS`: วาง User ID สูงสุด 5 คน คั่นด้วยเครื่องหมาย `,`
3. ด้านบนของ Editor เลือกชื่อฟังก์ชัน **`setupScriptProperties`** แล้วกดปุ่ม **Run (เรียกใช้)**
   - ครั้งแรก Google จะถามขออนุญาตสิทธิ์ (Authorization) -> กด **Review permissions -> เลือกบัญชี Google -> Advanced -> Go to ... (unsafe) -> Allow**
4. **คำแนะนำด้านความปลอดภัย**: เมื่อรัน `setupScriptProperties` สำเร็จแล้ว ให้ลบค่า Token จริงออกจากโค้ดใน `SetupProperties.gs` (ค่าจริงถูกเก็บอย่างปลอดภัยใน Project Settings -> Script Properties แล้ว)
5. ทดสอบส่ง LINE: เลือกฟังก์ชัน **`testLineNotification`** แล้วกด **Run** -> ตรวจสอบว่ามีข้อความเข้า LINE หรือไม่
6. ติดตั้งตัวตั้งเวลาอัตโนมัติ: เลือกฟังก์ชัน **`installAllTriggers`** แล้วกด **Run**
   - ระบบจะสร้าง Trigger 3 ตัวให้อัตโนมัติ:
     - `checkAndNotifyBoilerStatus`: ตรวจค่าแรงดันและแจ้งเตือนฉุกเฉินทุก 1 นาที
     - `sendDailySummary`: ส่งสรุปรายวันเวลา 18:00–19:00 น.
     - `runAnnualArchiveIfJanuary`: ตรวจขึ้นปีใหม่ทุกวันที่ 1 เวลา 01:00 น. เพื่อสำรอง CSV ปีเก่า

---

## ขั้นตอนที่ 5: Deploy Google Apps Script เป็น Web App

1. ในหน้า Apps Script คลิกปุ่มสีน้ำเงิน **Deploy (ทำให้ใช้งานได้) -> New deployment (การทำให้ใช้งานได้รายการใหม่)**
2. คลิกไอคอนเฟืองข้าง **Select type** -> เลือก **Web app**
3. ตั้งค่าตามนี้เป๊ะๆ:
   - **Description**: `Boiler Monitor API v1`
   - **Execute as (ดำเนินการในฐานะ)**: **`Me (อีเมลของคุณ)`** *(สำคัญ! เพื่อให้หน้าเว็บอ่านชีตได้โดยผู้ใช้ไม่ต้องล็อกอิน Google)*
   - **Who has access (ผู้ที่มีสิทธิ์เข้าถึง)**: **`Anyone (ทุกคน)`** *(ปลอดภัยเพราะระบบตรวจ `token` ใน URL ก่อนส่งข้อมูลเสมอ)*
4. กด **Deploy** แล้วคัดลอก **Web app URL** (ต้องลงท้ายด้วย `/exec`) เก็บไว้

> **ข้อควรจำสำหรับมือใหม่**: หากในอนาคตคุณแก้ไขโค้ด `.gs` ใน Apps Script URL เดิมจะยังรันโค้ดเก่าอยู่! ต้องกด **Deploy -> Manage deployments -> รูปดินสอ (Edit) -> Version: New version -> Deploy** ทุกครั้งที่แก้โค้ด

### ทดสอบ URL API ในเบราว์เซอร์ก่อนต่อหน้าเว็บ
เปิดแท็บใหม่แล้วลองวาง URL นี้ (เปลี่ยน `YOUR_URL` และ `YOUR_TOKEN` เป็นของคุณ):
- ทดสอบดึงค่าล่าสุด:
  `https://script.google.com/macros/s/YOUR_URL/exec?action=latest&token=YOUR_TOKEN`
- ทดสอบดึงย้อนหลัง:
  `https://script.google.com/macros/s/YOUR_URL/exec?action=history&from=2026-11-25&to=2026-11-25&token=YOUR_TOKEN`

ถ้าเห็นข้อมูล JSON ที่มี `"ok": true` แสดงว่าฝั่ง Backend พร้อม 100%

---

## ขั้นตอนที่ 6: ต่อข้อมูล Line 1–4 เพิ่มใน Google Apps Script

Dropdown หน้าเว็บเปิดให้เลือกทั้ง **`Boiler (เมนหลัก)`** และ **`Line 1 – Line 4`** แล้ว เพียงนำลิงก์หรือชื่อแท็บของแต่ละ Line ไปใส่ใน `apps-script/Config.gs` ตรงหัวข้อ `STATIONS`:
- **กรณีแยกไฟล์ / ใช้ลิงก์ `pub?output=csv` ของแต่ละ Line**: นำลิงก์ไปวางใน `publishedCsvUrl` ของ `line-1` ถึง `line-4`
- **กรณีอยู่ใน Google Sheet ไฟล์เดียวกันแต่คนละแท็บ (Tab)**: ตั้ง `DATA_SOURCE_MODE: 'SPREADSHEET'` แล้วใส่ชื่อแท็บของแต่ละ Line ใน `sheetName` (เช่น `'Line_1'`, `'Line_2'`)
- **กรณีอยู่คนละไฟล์ Google Sheet**: ใส่ `spreadsheetId` และ `sheetName` ของแต่ละ Line ได้เลย

---

## ขั้นตอนที่ 7: นำ URL และ Token มาใส่ในเว็บแอป

มี 2 วิธีให้เลือก:

### วิธีที่ A: ใส่ถาวรในไฟล์ `web/config.js` (แนะนำสำหรับใช้งานจริงทั้งองค์กร)
เปิดไฟล์ `web/config.js` แล้วแก้เฉพาะส่วน `api`:
```javascript
api: {
  webAppUrl: 'https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec',
  token: 'Boiler2026!SecretKey',
  refreshIntervalMs: 60000,
  requestTimeoutMs: 15000,
  allowDemoFallback: true
}
```

### วิธีที่ B: กรอกผ่านหน้าจอเว็บ (สำหรับทดสอบทันทีบนเครื่องตัวเอง)
เปิดไฟล์ `web/index.html` ในเบราว์เซอร์ -> กดปุ่ม **ตั้งค่าลิงก์ชีต** -> วาง Web App URL และ Token -> กด **บันทึกและเชื่อมต่อ**

---

## ขั้นตอนที่ 8: เผยแพร่หน้าเว็บให้เปิดดูได้จากมือถือและที่ไหนก็ได้ (ฟรี)

โฟลเดอร์ `web/` เป็นเว็บไฟล์นิ่ง (Static HTML/CSS/JS) ไม่ต้องใช้เซิร์ฟเวอร์เสียเงิน สามารถนำไปอัปโหลดฟรีได้ทันที เช่น:
1. **GitHub Pages (ฟรี)**: สร้าง Repository บน GitHub อัปโหลดไฟล์ในโฟลเดอร์ `web/` แล้วเปิด Settings -> Pages
2. **Netlify Drop / Cloudflare Pages (ฟรี)**: ลากโฟลเดอร์ `web/` ไปวางบนหน้าเว็บ Netlify Drop ก็จะได้ลิงก์ HTTPS เปิดจากมือถือได้ทันที (สามารถกด "Add to Home Screen" บน iOS/Android เพื่อใช้เหมือนแอปได้ด้วย)

> **ข้อควรระวังเรื่อง Token หน้าเว็บ**: เนื่องจากโค้ดหน้าเว็บทำงานฝั่งเบราว์เซอร์ ใครที่มีสิทธิ์เปิดลิงก์เว็บและกดดู Source Code จะเห็น `API_TOKEN` ได้ Token นี้จึงมีไว้ป้องกันการยิง API จากภายนอกแบบสุ่มเท่านั้น ห้ามใช้รหัสเดียวกับรหัสผ่านบัญชี Google หรือ LINE Token!
