# ChronoPass Frontend

หน้าเว็บ static ของ ChronoPass

## เวอร์ชัน

เวอร์ชัน Frontend ปัจจุบัน: **v1.1.1**

เมื่อมีการแก้ไข Frontend ที่ผู้ใช้มองเห็นหรือเปลี่ยนพฤติกรรม ให้ทำในชุดเดียวกัน:

1. เพิ่มเลขเวอร์ชันตาม semantic versioning ในไฟล์ `../VERSION`
2. เพิ่มรายการเปลี่ยนแปลงใน `../CHANGELOG.md`
3. อัปเดตเลขเวอร์ชันใน `home.html` และ footer ของ `index.html`
4. อัปโหลดไฟล์ Frontend ที่แก้ไขขึ้น GitHub Pages พร้อมกัน แล้วทดสอบด้วย hard refresh (`Ctrl + F5`)

ตัวอย่าง: การแก้ layout หรือการแยกข้อมูล Guest เป็น `v1.0.2`; ฟีเจอร์ใหม่ที่ยังเข้ากันได้กับของเดิมให้เพิ่มเลขกลาง เช่น `v1.1.0`; การแก้บั๊กอย่างเดียวให้เพิ่มเลขท้าย เช่น `v1.0.3`

### ประวัติเวอร์ชัน

| เวอร์ชัน | สถานะ                    | การเปลี่ยนแปลง Frontend หลัก                                                                                                  |
| -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` | First production release | หน้า Landing/Dashboard, LINE LIFF login, Guest mode, จัดการบัญชี AI, ตัวกรองและนับเวลา reset, สมัครแจ้งเตือน LINE ผ่าน Stripe |
| `v1.0.1` | Guest-to-LINE flow       | ผู้ใช้ Guest เห็นปุ่ม “เชื่อมต่อ LINE” แทนปุ่มสมัครแจ้งเตือนแบบเสียเงิน                                                       |
| `v1.0.2` | Data isolation & UI fix  | แยกข้อมูล Guest ออกจาก cache บัญชี LINE และล็อกความกว้างกล่องชื่อผู้ใช้ให้เท่ากัน                                             |
| `v1.0.3` | Profile persistence fix  | เพิ่ม `app-data` ในขั้นตอน deploy เพื่อให้บันทึกผู้ใช้จาก LINE LIFF ได้                                                        |
| `v1.0.4` | Cookie consent (PDPA)    | เพิ่มระบบขอความยินยอมคุกกี้ (Banner + Modal ตั้งค่า) ตามกฎหมาย PDPA และควบคุมการจัดเก็บแคช                                    |
| `v1.0.5` | Service overview layout  | แสดงจำนวนบัญชีพร้อมใช้เป็นสีน้ำเงิน และย้ายจำนวนบัญชีทั้งหมดไปบรรทัดล่างของการ์ดบริการ                                      |
| `v1.0.6` | Dashboard summary layout | แสดงสัดส่วนพร้อมใช้ต่อบัญชีทั้งหมด ตัดสรุปใช้แล้ว และย้ายข่าวอัปเดตไว้เหนือการ์ดสรุป                                        |
| `v1.1.0` | Data reliability         | เพิ่มการซิงค์พร้อมสถานะล่าสุด ยืนยันการลบ ตั้งรอบรีเซ็ตเอง และชุดทดสอบ reset schedule                                         |
| `v1.1.1` | iOS PWA Login Fix        | ตรวจจับ iOS Standalone Mode และสลับไปใช้ LINE OAuth URL Direct เพื่อแก้ปัญหาล็อกอินค้างบน iPhone Home Screen                 |

รายละเอียดครบทุกส่วนของโปรเจกต์ดูได้ที่ [`../CHANGELOG.md`](../CHANGELOG.md)

## ไฟล์สำคัญ

- `index.html` — หน้า landing และเข้าสู่ระบบ
- `home.html` — หน้า dashboard และค่า public configuration (`window.APP_CONFIG`)
- `callback.html` — หน้ารับ callback หลัง LINE LIFF login
- `assets/css/` — stylesheet
- `assets/js/` — logic ของ landing page และ dashboard

## การรันในเครื่อง

ให้เปิดผ่าน local static server แทนการดับเบิลคลิกไฟล์ HTML เพื่อให้การ redirect และ LIFF ทำงานได้ตามปกติ เช่น Live Server หรือ web server ที่ใช้อยู่

ค่าที่เบราว์เซอร์ใช้ได้ (`SUPABASE_URL`, Supabase anon key และ `LIFF_ID`) อยู่ใน `home.html` เท่านั้น ห้ามใส่ service role key, Stripe secret หรือ LINE channel access token ลงใน Frontend
