# Noveltail

คู่มือติดตั้งและใช้งานโปรเจกต์ Noveltail ฉบับภาษาไทย ไฟล์นี้อยู่ระดับเดียวกับ `NoveltailApp/` และ `Noveltail_full.sql`

> **ความปลอดภัยของฐานข้อมูล:** `Noveltail_full.sql` เป็น backup โครงสร้างสะอาดและข้อมูลตั้งต้นประเภทนิยาย/ประเภทเรื่องเท่านั้น ไม่มีบัญชีผู้ใช้เดิม หลัง Restore ให้สร้าง SUPER_ADMIN ด้วย initializer ก่อนเข้าสู่ระบบ ห้าม Restore ทับฐานข้อมูลที่ใช้งานอยู่หรือฐาน Production

## 1. ภาพรวมโครงการ

Noveltail เป็นเว็บไซต์สำหรับค้นหา อ่าน และเขียนนิยาย มี Frontend ที่ให้บริการโดย Express, API สำหรับการทำงานของเว็บไซต์ และ PostgreSQL สำหรับข้อมูลถาวร ระบบเหรียญเป็นข้อมูลจำลองเพื่อการศึกษา ไม่ใช่การชำระเงินจริง

## 2. วัตถุประสงค์

- เชื่อมหน้าเว็บและ API เข้ากับ PostgreSQL
- รองรับขั้นตอนการอ่าน เขียน ติดตาม สื่อสาร และดูแลระบบ
- รักษา Schema และกฎธุรกิจใน `NoveltailApp/PROJECT_DECISIONS.md`
- ป้องกันการใช้ข้อมูลทดสอบหรือ LocalStorage แทนข้อมูลถาวร

## 3. ความสามารถของระบบ

- สมัครสมาชิก เข้าสู่ระบบ ออกจากระบบ และตรวจสอบ Session
- ค้นหาและอ่านนิยาย จัดการนิยายและตอนสำหรับผู้เขียน
- Bookmark, Reading History, Follow ผู้เขียน/นิยาย, Comments, Replies, Reviews และ Reactions
- Wallet เหรียญจำลอง, Top-up, Paid Chapter, Ledger และการทำรายการย้อนกลับ
- Notifications, Announcements (including pinned Home carousel), Reports, Moderation, Suspension และ Appeals
- หน้าจัดการรายงานและหน้าจัดการบัญชี ADMIN สำหรับ SUPER_ADMIN
- ธีมสว่าง/มืดและ Layout แบบ Responsive

ความสามารถขึ้นอยู่กับ Schema และการตั้งค่าของฐานข้อมูลเป้าหมาย โปรดดูหัวข้อ Migration และข้อจำกัดก่อนใช้งาน

## 4. เทคโนโลยี

- Node.js และ Express
- PostgreSQL ผ่าน `pg` connection pool
- HTML, CSS และ Vanilla JavaScript
- Tailwind CSS v4
- Node Test Runner, Playwright และ axe-core

โปรเจกต์ไม่มี ORM และไม่มี Payment Gateway

## 5. สถาปัตยกรรม

1. Browser โหลดหน้าเว็บและไฟล์ Frontend จาก `NoveltailApp/public/`
2. Frontend เรียก Express API แบบ Same-origin
3. Middleware ตรวจ Session, Role, CSRF, Rate Limit และข้อมูลนำเข้า
4. Route ใช้ SQL แบบ Parameterized และ Transaction กับ PostgreSQL
5. Constraint, Trigger และ Ledger ใน PostgreSQL ควบคุมความถูกต้องของข้อมูล
6. Tailwind CSS ถูก Build จาก `NoveltailApp/styles/tailwind.css` ไปยัง `NoveltailApp/public/tailwind.css`

ระบบใช้ Cookie `noveltail_token` สำหรับ Session และตรวจ Origin/CSRF สำหรับ Request ที่เปลี่ยนแปลงข้อมูล

## 6. โครงสร้างโปรเจกต์

```text
Noveltail/
|-- NoveltailApp/
|   |-- config/                 # Runtime และ database validation
|   |-- docs/                   # เอกสารประกอบและหลักฐานการตัดสินใจ
|   |-- middleware/             # Authentication, CSRF, rate limit, authorization
|   |-- migrations/             # PostgreSQL migrations 001–007
|   |-- public/                 # HTML, JavaScript, CSS และไฟล์ที่ Build แล้ว
|   |-- routes/                 # Express API
|   |-- scripts/                # Test, migration check และ SUPER_ADMIN setup
|   |-- services/               # Backend services
|   |-- sql/                    # SQL initialization และ emergency scripts
|   |-- styles/                 # Tailwind CSS source
|   |-- tests/                  # API, integration และ Playwright tests
|   |-- uploads/                # รูปภาพที่ระบบจัดการ
|   |-- .env.example            # ตัวอย่าง Environment Variables
|   |-- package.json
|   |-- package-lock.json
|   |-- server.js
|   `-- PROJECT_DECISIONS.md
|-- Noveltail_full.sql          # PostgreSQL clean backup
`-- README.md
```

## 7. สิ่งที่ต้องติดตั้ง

1. Node.js รุ่น LTS ที่ยังได้รับการสนับสนุน พร้อม npm
2. PostgreSQL 18 (backup นี้สร้างจาก PostgreSQL 18)
3. PostgreSQL Command Line Tools: `psql`, `createdb`, `pg_dump`, `pg_restore`
4. สิทธิ์สร้างฐานข้อมูลใหม่แบบ Local/Disposable
5. Chromium ของ Playwright เฉพาะเมื่อต้องรัน Browser Tests

บน Windows หากไม่พบคำสั่ง PostgreSQL ให้เพิ่ม `C:\Program Files\PostgreSQL\18\bin` เข้า `PATH` หรือเรียกไฟล์ `.exe` ด้วย path เต็ม

## 8. ติดตั้ง PostgreSQL

ติดตั้ง PostgreSQL 18 จากผู้จัดจำหน่ายที่เชื่อถือได้ แล้วเริ่ม PostgreSQL Service ตั้งรหัสผ่านของผู้ดูแลฐานข้อมูลอย่างปลอดภัย และตรวจสอบ:

```powershell
psql --version
```

คำสั่งตัวอย่างต่อไปนี้ใช้ PowerShell และสมมติว่า PostgreSQL ฟังที่ `localhost:5432`

## 9. สร้างฐานข้อมูลใหม่

เปิด PowerShell ที่โฟลเดอร์ระดับบนสุดของโปรเจกต์ แล้วสร้างฐานข้อมูลใหม่ ห้ามใช้ชื่อฐานที่มีข้อมูลอยู่แล้ว:

```powershell
createdb -h localhost -p 5432 -U postgres Noveltail_local
```

ถ้าฐาน `Noveltail_local` มีอยู่แล้ว ให้เลือกชื่อฐานใหม่และใช้ชื่อนั้นให้ตรงกันทั้งตอน Restore และใน `.env` อย่า Drop หรือ Reset ฐานเดิมเพื่อแก้ปัญหาการติดตั้ง

## 10. Restore `Noveltail_full.sql`

Restore ไฟล์ SQL ไปยังฐานที่เพิ่งสร้าง โดยรันจากโฟลเดอร์ระดับบนสุด:

```powershell
psql -h localhost -p 5432 -U postgres -d Noveltail_local -v ON_ERROR_STOP=1 -f .\Noveltail_full.sql
```

รอให้คำสั่งจบโดยไม่มี Error ไฟล์เป็น Plain SQL และไม่สร้างฐานข้อมูลปลายทางให้อัตโนมัติ Schema ที่ Restore มี 29 ตาราง, 20 sequences, 89 indexes, 288 constraints, function และ trigger โดยคงข้อมูลตั้งต้น 13 genres ไว้ ไม่มีบัญชีผู้ใช้, wallets, rate-limit entries หรือนิยาย/เนื้อหาผู้ใช้

## 11. ตั้งค่า Environment

เปิด PowerShell ใน `NoveltailApp/` แล้วสร้าง `.env` จากตัวอย่าง:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

แก้ `.env` บนเครื่องโดยไม่ส่งไฟล์นี้ให้ผู้อื่น:

| ตัวแปร | ค่าที่ใช้พิจารณาสำหรับ Local |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` หรือ Port ที่ติดตั้งไว้ |
| `DB_NAME` | `Noveltail_local` |
| `DB_USER` | `postgres` สำหรับ Local ที่ใช้ Restore ด้วยผู้ดูแลฐาน |
| `DB_PASSWORD` | รหัสผ่าน PostgreSQL Local |
| `DB_SSL` | `false` สำหรับ PostgreSQL Local ที่ไม่ใช้ TLS |
| `DB_POOL_MAX` | ใช้ค่าเริ่มต้นใน `.env.example` ได้ |
| `JWT_SECRET` | แทนค่า Placeholder ด้วย Secret สุ่มที่ไม่ซ้ำและยาวอย่างน้อย 32 bytes |
| `NODE_ENV` | `development` |
| `PORT` | `3000` หรือ Port ว่าง |
| `APP_ORIGIN` | เว้นว่างสำหรับการพัฒนา Local แบบตรง หรือกำหนด Origin ให้ตรงกับเว็บไซต์ |
| `TRUST_PROXY_HOPS` | เว้นว่างเมื่อไม่ได้อยู่หลัง Proxy |
| `RATE_LIMIT_STORE` | `memory` สำหรับ Local |

สำหรับ Production ต้องใช้ TLS, Secret เฉพาะระบบ, Runtime Role สิทธิ์ต่ำ และ PostgreSQL shared rate-limit store การ Deploy จริงยังมีข้อจำกัด โปรดอ่านหัวข้อ 24

## 12. ติดตั้ง Dependencies

จาก `NoveltailApp/` ติดตั้งตาม Lockfile:

```powershell
npm ci
```

## 13. Build Tailwind CSS

```powershell
npm run build
# Equivalent direct command:
npm run build:css
```

ทั้งสองคำสั่ง Build `styles/tailwind.css` ไปยัง `public/tailwind.css`; `npm run build` เป็น Alias ของ CSS build เพราะโปรเจกต์ไม่มีขั้นตอน Compile อื่น

## 14. เปิดเว็บไซต์

เริ่มแบบ Development ซึ่งจะ Build CSS และเปิด Node watch mode:

```powershell
npm run dev
```

หรือ Build CSS ก่อน แล้วเริ่ม Server ปกติ:

```powershell
npm run build:css
npm start
```

เปิด `http://localhost:3000` ใน Browser และหยุด Server ด้วย `Ctrl+C`

## 15. สมัครสมาชิกและเข้าสู่ระบบ

- ผู้ใช้ทั่วไปสมัครได้จากหน้า Authentication แล้วเข้าสู่ระบบด้วย Username หรือ Email
- บัญชีใหม่เริ่มด้วย Wallet ศูนย์เหรียญ
- หลัง Restore ต้องสร้าง SUPER_ADMIN ก่อน โดยอยู่ในโฟลเดอร์ `NoveltailApp/` แล้วรัน:

```powershell
node .\scripts\initialize-superadmin.js
```

สคริปต์จะแสดง Database Identity ที่เชื่อมต่อและให้พิมพ์ชื่อฐานเพื่อยืนยัน จากนั้นรับรหัสผ่านแบบไม่แสดงบนหน้าจอ สร้าง bcrypt hash cost 12 ในหน่วยความจำ และส่งให้ SQL Initialization บัญชีที่สร้างคือ `SuperAdmin` / `SuperAdmin@gmail.com` โดยไม่มีรหัสผ่านตั้งต้นที่ฝังไว้ใน Source หรือ Backup การรันซ้ำจะไม่เขียนทับบัญชี รหัสผ่าน หรือ Wallet เดิม

การเปลี่ยนรหัสผ่าน SUPER_ADMIN ทำได้ผ่าน SQL เท่านั้น ใช้คำสั่งนี้เพื่อให้สคริปต์รับรหัสผ่านใหม่แบบซ่อนและทำ SQL Update:

```powershell
node .\scripts\initialize-superadmin.js --reset-password
```

## 16. คู่มือผู้ใช้

- ใช้หน้า Home เพื่อค้นหาและเปิดนิยายที่เผยแพร่แล้ว
- Bookmark นิยายและ Follow ผู้เขียนหรือนิยายที่สนใจ
- ดู Reading History และ Notifications จากหน้าที่เกี่ยวข้อง
- แสดงความคิดเห็น ตอบกลับ รีวิว และใช้ Reactions ตามสิทธิ์บัญชี
- ส่ง Report จาก Novel, Chapter หรือ Comment; เป้าหมายของรายงานมาจากข้อมูลในระบบ
- ดูสถานะรายงานของตนเองได้ในหน้า Reports

## 17. คู่มือผู้เขียน

1. สมัครหรือเข้าสู่ระบบด้วยบัญชีผู้ใช้
2. เปิด My Novels เพื่อสร้างนิยายและกำหนด Genre
3. แก้ไขรายละเอียดหรือรูปปกผ่านหน้าจัดการนิยาย
4. เปิด Manage Chapters เพื่อสร้าง แก้ไข บันทึก Draft หรือเผยแพร่ตอน
5. ตอนใหม่เป็น Free โดยค่าเริ่มต้น และกำหนดตอนแบบ Paid ได้ตามกฎเดิม

อย่าจัดการเนื้อหาด้วยการแก้หรือลบข้อมูลใน PostgreSQL โดยตรง

## 18. คู่มือผู้อ่าน

- เปิดนิยายที่เผยแพร่และเลือก Chapter จากรายการ
- ใช้ Reader เพื่ออ่านและย้ายไปยังตอนที่เข้าถึงได้
- เข้าสู่ระบบเพื่อเก็บ History, Bookmark, Follow, Comment และ Review
- สิทธิ์การอ่านตรวจสอบที่ Server; การแก้ค่าใน Browser ไม่ปลดล็อกเนื้อหา

## 19. Wallet และ Paid Chapter

- เหรียญเป็นข้อมูลจำลอง ไม่มีการตัดเงินจริง
- Top-up Packages คงที่: 50, 100, 300, 500 และ 1,000 เหรียญ
- การซื้อและ Top-up ใช้ Idempotency Key เพื่อป้องกันการคิดยอดซ้ำ
- Wallet ห้ามติดลบและ Ledger เป็น Append-only
- รายได้ Chapter แบ่งผู้เขียน 90% / ระบบ 10%; ส่วนของผู้เขียนปัดลงเป็นจำนวนเต็มและส่วนที่เหลือเป็นของระบบ
- Refund/Cancel เป็นรายการกลับบัญชีใหม่ที่อ้างอิงรายการต้นทาง ไม่แก้หรือลบ Ledger เดิม

ห้ามใช้ระบบนี้รับหรือแทนเงินจริง

## 20. คู่มือ Admin และการจัดการ Role

- ADMIN และ SUPER_ADMIN เข้าหน้า Admin Dashboard ได้ตาม Role และสิทธิ์ที่กำหนดใน `NoveltailApp/PROJECT_DECISIONS.md`
- Dashboard มี Workflow สำหรับ Moderation, Account Suspension, Appeals, Wallet Reversal, Report และ Announcements
- ผู้ดูแลสามารถ Preview ประกาศ ใส่ลิงก์ HTTP/HTTPS หรือ path ภายใน ตั้งค่าการปักหมุด/ลำดับ แสดงบนหน้า Home และยกเลิกการเผยแพร่หรือลบประกาศได้
- เฉพาะ SUPER_ADMIN เท่านั้นที่ค้นหาผู้ใช้ กรอง Role แต่งตั้ง USER เป็น ADMIN หรือถอดถอน ADMIN กลับเป็น USER ผ่านหน้า Manage Accounts ได้
- ก่อนเปลี่ยน Role หน้าเว็บขอการยืนยันและเหตุผล ทุกการเปลี่ยนจริงถูกบันทึกใน `admin_action_logs`
- API ตรวจ `role === SUPER_ADMIN` ที่ Backend และรับเฉพาะ `USER`/`ADMIN`; ไม่อนุญาตให้สร้างหรือแก้ SUPER_ADMIN ผ่าน Web/API

กรณีฉุกเฉินที่ต้องจัดการ ADMIN ผ่าน SQL โดยตรง ให้ทำจากฐานที่ยืนยันตัวตนแล้วเท่านั้น คำสั่งจะใช้ SuperAdmin ปัจจุบันเป็นผู้กระทำและบันทึก Audit Log ใน Transaction:

รันจากโฟลเดอร์ `NoveltailApp/`:

```powershell
psql -h localhost -p 5432 -U postgres -d Noveltail_local -X -v ON_ERROR_STOP=1 -v target_user_id=123 -v target_role=ADMIN -v "reason=Emergency role correction" -f .\sql\emergency-admin-role.sql
```

แทน `123` ด้วย `user_id` จริง หากต้องถอดถอน ADMIN ให้ตั้ง `target_role=USER` คำสั่งนี้ปฏิเสธ SUPER_ADMIN และยกเลิกเมื่อไม่พบ SUPER_ADMIN เพียงหนึ่งบัญชี

การแก้ชื่อ/อีเมลหรือการลบบัญชี SUPER_ADMIN ต้องทำผ่าน SQL โดยเจ้าของฐานข้อมูลเท่านั้น ใช้ Transaction และ Advisory Lock เดียวกัน (`pg_advisory_xact_lock(20261112, 1)`); ห้ามใช้ `CASCADE` เพราะอาจทำลาย Foreign-Key History เมื่อเปลี่ยนข้อมูลประจำตัว ให้ปรับค่าที่ initializer ตรวจสอบอย่างมีการทบทวน มิฉะนั้น initializer จะหยุดเมื่อพบข้อมูลขัดแย้ง

ตัวอย่าง SQL สำหรับเปลี่ยนข้อมูลประจำตัวบัญชีเดิม (แทน `USER_ID` และค่าตัวอย่างก่อนรัน):

```sql
BEGIN;
SELECT pg_advisory_xact_lock(20261112, 1);
UPDATE users
SET username = 'NewSuperAdmin',
    display_name = 'New SuperAdmin',
    email = 'new-superadmin@example.test',
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = USER_ID
  AND role = 'SUPER_ADMIN';
-- ตรวจให้ UPDATE เปลี่ยนหนึ่งแถว แล้ว COMMIT; มิฉะนั้น ROLLBACK
COMMIT;
```

การลบบัญชีทำได้เฉพาะ SQL เช่น `DELETE FROM users WHERE user_id = USER_ID AND role = 'SUPER_ADMIN';` ภายใน Transaction/Advisory Lock และต้องตรวจให้คงจำนวน SUPER_ADMIN ตามนโยบาย การลบอาจถูก Foreign Key ปฏิเสธเมื่อบัญชียังมีประวัติอ้างอิง ห้ามแก้ปัญหาด้วย `CASCADE`

## 21. ส่งและตรวจ Report

- ผู้ใช้ที่เข้าสู่ระบบส่งรายงาน Novel, Chapter หรือ Comment ได้
- ระบบสร้าง Report ID และ Snapshot จากฐานข้อมูล แล้วแสดง ID หลังส่งสำเร็จ
- ผู้ใช้เห็นสถานะของรายงานตนเอง ส่วน Admin ดู Snapshot และประวัติการดำเนินการได้ตามสิทธิ์
- Admin รับเรื่อง ตรวจสอบ และตัดสินตามสถานะที่อนุญาต โดยบันทึกเหตุผลและ Audit Log
- ป้องกันรายงานเปิดซ้ำต่อ Reporter/Target เดียวกันตาม Constraint เดิม

## 22. คำสั่งทดสอบ

รันจาก `NoveltailApp/`:

```powershell
npm test
npm run test:e2e
npm run build
npm run build:css
npm run migration:check
```

`npm test` และ `npm run test:e2e` ใช้ `pg_dump`/`pg_restore` สร้างฐาน Disposable จาก Schema-only snapshot แล้ว replay migrations 001–007 บนฐานทดสอบ ใช้ข้อมูลสังเคราะห์และลบฐานทดสอบเมื่อเสร็จ ไม่คัดลอกข้อมูลตารางจากฐานต้นทาง การรันทดสอบต้องมีสิทธิ์สร้าง/ลบฐานทดสอบ ห้ามแก้ Script ให้ทดสอบเขียนลงฐานจริง

หาก Playwright แจ้งว่าไม่มี Chromium ให้ติดตั้ง:

```powershell
npx playwright install chromium
```

`npm run migration:check` เป็นการตรวจ Schema แบบ Read-only ไม่ Apply Migration

## 23. Migration Status

ไฟล์ Migration อยู่ใน `NoveltailApp/migrations/`:

| Migration | เนื้อหา | สถานะของ clean backup/ฐานที่ตรวจสอบ |
|---|---|---|
| 001 | Wallet, Paid Chapters, Notifications | Schema อยู่ใน Baseline |
| 002 | Reversals, Moderation, Appeals | Schema อยู่ใน Baseline |
| 003 | Account Suspension | Schema อยู่ใน Baseline |
| 004 | Reports และ Announcements | Schema อยู่ใน Baseline |
| 005 | PostgreSQL shared rate-limit store | Applied to local `Noveltail` on 2026-11-12 after a full backup and restore test |
| 006 | Report target snapshots | Applied to local `Noveltail` on 2026-11-12 after a full backup and restore test |
| 007 | Announcement Home Carousel (pinning, order, and links) | Applied to local `Noveltail` on 2026-11-12 after a full backup and restore test |

ไม่พบ Migration Ledger Table จึงไม่ได้สร้างหรือบันทึกสถานะปลอม; ยืนยันสถานะจาก schema โดยตรงแทน ก่อน Apply ได้สร้าง custom-format backup ไว้นอก Repository และ Restore ไปฐาน Disposable ซึ่งยืนยัน 28 ตาราง, ข้อมูลทุกตาราง, sequence values และ object counts ตรงกัน หลัง Apply 005–007 ที่ Local `Noveltail` จำนวนตารางเป็น 29 และจำนวนแถวของ 28 ตารางเดิมไม่เปลี่ยน มีบัญชี SUPER_ADMIN 1 รายการ, wallet 1 รายการ และ genres 13 รายการ `Noveltail_full.sql` ได้รับการสร้างใหม่เป็น clean backup หลัง migrations โดย Restore ทดสอบผ่าน มี 29 ตารางและไม่มีบัญชีหรือข้อมูลผู้ใช้ การเปลี่ยนแปลงนี้จำกัดเฉพาะฐาน Local `Noveltail` ที่ `localhost:5432` ไม่ใช่การอนุมัติ Production Deployment

## 24. ข้อจำกัดที่ทราบ

- Backup ที่สะอาดไม่มีบัญชีผู้ใช้ ต้องเรียก SQL initializer ก่อน Login
- Production Deployment ยังไม่พร้อมใช้งาน: การ Apply schema บน Local ไม่ได้จัดเตรียม Runtime Role/สิทธิ์แบบ least privilege, signed baseline, enforced deployment gate, HTTPS/proxy environment หรือ Production owner approval
- Production ต้องแยก Migration Owner ออกจาก Runtime Role และห้ามใช้ PostgreSQL Superuser เป็น Runtime
- In-memory rate limiting ใช้สำหรับ Local เท่านั้น; Multi-instance Production ต้องตั้งค่าและตรวจสิทธิ์ PostgreSQL shared store ตาม deployment gate
- Notifications ไม่ใช่ Real-time Push
- เหรียญเป็นการจำลอง ไม่มี Payment Gateway
- การตรวจ Responsive/Accessibility อัตโนมัติไม่ทดแทนการตรวจทุก Browser/อุปกรณ์ด้วยคน

กฎธุรกิจและข้อจำกัดอ้างอิงได้ที่ `NoveltailApp/PROJECT_DECISIONS.md` และเอกสารใน `NoveltailApp/docs/`

## 25. ข้อควรระวังด้านความปลอดภัย

- ห้าม Commit `.env`, รหัสผ่าน, JWT Secret, Database Credential หรือ bcrypt hash
- อย่าใช้รหัสผ่านตั้งต้นที่แชร์หรือคาดเดาได้ เลือกรหัสผ่าน SUPER_ADMIN ที่ไม่ซ้ำและเก็บใน Password Manager
- ห้าม Reset หรือล้างข้อมูลฐานจริง; ก่อนเปลี่ยน schema บนเป้าหมายอื่นต้องสำรองและทดสอบ Restore พร้อมใช้ reviewed deployment process
- Migration 005–007 ถูก Apply เฉพาะฐาน Local `Noveltail` ตามการอนุญาตล่าสุด; ห้ามเปลี่ยน Role/Grant หรือถือว่า Production ผ่านการอนุมัติ
- คง CSRF, Same-origin, TLS, Rate Limit และ Role Authorization ตาม Environment
- ใช้ข้อมูลสังเคราะห์สำหรับการทดสอบ และอย่ารายงานว่า Production-ready
