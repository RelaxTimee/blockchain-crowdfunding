# ผลตรวจและขอบเขตการทดสอบ

ตรวจวันที่ 15 พฤศจิกายน 2026 (Asia/Bangkok) โดยอ่าน PDF โจทย์ 1 หน้าและ verified source/ABI ของ address ที่ผู้ใช้ระบุ ไม่มีการส่งธุรกรรมไปเครือข่ายสาธารณะหรือใช้ Wallet จริงของผู้ใช้

## Automated tests

`npm test` ผ่าน 48 กรณีใน 3 suites:

- แปลง ETH เป็น wei โดยไม่สูญเสียความแม่นยำ; ปฏิเสธค่าติดลบ ศูนย์ scientific notation และทศนิยมเกิน 18 หลัก
- ตรวจจำนวน Milestone, สัดส่วนรวม 100%, รายละเอียด และนาทีที่ถูกต้อง
- ตรวจขอบเขต deadline แบบ `<=` และ `>` ตาม Solidity จริง
- ตรวจ creator, contributor, ลำดับระยะงาน, การโหวตซ้ำ, refund eligibility
- เกณฑ์อนุมัติแบบ strict มากกว่า 50%, allocation และเศษปัดระยะสุดท้าย
- HTML escaping และอนุญาต clickable evidence เฉพาะ HTTPS
- Compile source อ้างอิงด้วย Solidity compiler ใน lockfile แล้วตรวจ ABI ตรงกับ Etherscan ABI ทุก entry
- รัน source เดียวกันบน Anvil local EVM และเรียกผ่าน `transact` adapter ที่ production frontend ใช้จริง
- สร้างโครงการ, สนับสนุนจาก 2 บัญชี, เก็บ ETH ใน escrow, ส่งหลักฐาน, 50% ยังไม่จ่าย, ป้องกันโหวตซ้ำ, จ่ายอัตโนมัติหลังผ่านเกณฑ์, จ่ายครบตามลำดับ, ป้องกันเบิกซ้ำ
- คืนเงินเมื่อไม่ถึงเป้าหมาย, เคลียร์ contribution, ป้องกันคืนซ้ำ และเก็บ totalRaised เป็นยอดสะสมเดิม
- ปฏิเสธ wrong network และบัญชี Wallet ที่เปลี่ยนไปก่อนส่งธุรกรรม
- เชื่อม Wallet, เพิ่มเครือข่ายที่ยังไม่มี, ยกเลิกการเปลี่ยนเครือข่าย และตรวจ chain หลังเปลี่ยน
- โหลด Events โดยไม่ข้าม block, แบ่งช่วงเมื่อ RPC จำกัดขนาด, หยุดทันทีเมื่อ network error และเก็บอนุมัติ/จ่ายใน transaction เดียวครบทั้งสองรายการ

Anvil binaries เป็น optional dependencies แยกตาม OS รองรับ Windows/Linux/macOS x64 และ Linux/macOS ARM64 ทดสอบไม่ได้หากติดตั้งด้วย `--omit=optional` หรือ OS/architecture นอกเหนือรายการนี้

## Browser QA

ตรวจด้วย in-app browser:

1. หน้า production configuration อ่าน Sepolia จริงได้โดยไม่เชื่อม Wallet; แสดง 0 โครงการและ 0 ETH ตาม chain ขณะตรวจ
2. ตรวจ desktop และ viewport 390 × 844; ไม่มี horizontal page overflow ในหน้าที่ตรวจ
3. สร้างฟอร์ม, กรอกข้อมูล, แจ้งผลรวมสัดส่วน 99% ไม่ผ่าน และแจ้งต้องเชื่อม Wallet เมื่อกดสร้างโดยยังไม่เชื่อม
4. ใช้ test-only local RPC proxy + Anvil + injected test wallet ในไฟล์ `tmp/` ที่ git ignore และไม่อยู่ใน production build เพื่อทดสอบ UI ที่มีข้อมูล
5. สนับสนุน 0.05 local ETH แล้ว progress/ยอด/ประวัติอัปเดต
6. ผู้สนับสนุน A โหวตได้ 50% แล้วระยะงานยัง Requested, ปุ่มโหวตซ้ำถูกปิด
7. เปลี่ยนเป็นผู้สนับสนุน B แล้วโหวต ทำให้จ่าย 0.3 local ETH อัตโนมัติ แสดงยอดคงเหลือและ Events ทั้งอนุมัติ/จ่ายในธุรกรรมเดียว
8. เปลี่ยนเป็น creator แล้วส่ง HTTPS evidence ของระยะถัดไปได้ตามลำดับ
9. สร้าง campaign ใหม่ผ่าน modal สำเร็จและแสดง campaign ที่สร้าง
10. ผู้สนับสนุนขอคืน 0.2 local ETH จากโครงการที่ไม่ถึงเป้า ยอดคืน/คงเหลืออัปเดต และปุ่มคืนซ้ำถูกปิด

ข้อมูลทดสอบเหล่านี้ไม่ได้ถูกส่งไป Sepolia และไม่ใช่ข้อมูลตัวอย่างที่แสดงแทนข้อมูลจริงใน product

## Build และ dependency

- `npm run build` ผ่าน TypeScript strict และ Vite production build
- `npm audit` / `npm audit --omit=dev` ไม่พบช่องโหว่ที่ registry รายงานขณะตรวจ
- Vite ใช้ relative base (`./`) เพื่อรองรับ repository subpath บน GitHub Pages
- ทดลอง serve production build ที่ `/blockchain-crowdfunding/` แล้วตรวจ HTML, JavaScript, CSS และ favicon ได้ HTTP 200 ครบ
- CI ให้รัน tests/build ก่อน deploy และ PR ไม่ deploy
- ตรวจ build artifacts ว่าไม่มี test-only fixture, source contract, private key หรือไฟล์ `.env`

## Live Sepolia

ดูตัวเลขและ hashes ที่ `sepolia-check.json` โดยรันซ้ำได้:

```powershell
npm run check:sepolia
```

ขณะตรวจ snapshot block `12136171`: chain ID `11155111`, campaign count `0`, contract balance `0 wei`, approvalPercent `50`; creation block `12132435`

## ขอบเขตที่ยังต้องทดสอบด้วยบัญชีผู้ใช้

- การอนุมัติ popup ของ MetaMask/Wallet จริง และการทำธุรกรรมบน public Sepolia ไม่ได้ทำแทนผู้ใช้
- GitHub repository ยังไม่ได้สร้างหรือ push; workflow และ Pages deployment ยังต้องรันบน GitHub ตามคู่มือ
- ตรวจ bytecode ว่ามี code จริงและบันทึก hash; ไม่ได้ independently reproduce runtime bytecode พร้อม compiler metadata เทียบกับ deploy
- Browser QA เป็นการตรวจ flow และ layout สำคัญ ไม่ครอบคลุมทุก browser/Wallet extension หรือผู้ใช้พร้อมกันจำนวนมาก
- ไม่มีข้อรับประกัน bug-free หรือ security audit สำหรับเงินจริง; backend มีข้อจำกัดตาม `CONTRACT_ANALYSIS.md`

## ลองสาธิตด้วย Wallet จริงบน Sepolia

1. บัญชี A สร้างโครงการ เป้า 0.002 ETH ระยะ 3–5 นาที Milestone 40% + 60%
2. บัญชี B และ C สนับสนุนบัญชีละ 0.001 ETH
3. รอพ้น deadline; A ส่งหลักฐาน Milestone แรก
4. B โหวต: 50% ยังไม่จ่าย; C โหวต: จ่าย 0.0008 ETH ให้ A (ไม่รวม Gas)
5. A ขอเบิกระยะสอง; B/C อนุมัติ แล้วจ่ายส่วนเหลือ 0.0012 ETH
6. สร้างโครงการใหม่ที่ตั้งเป้าสูงกว่ายอดสนับสนุน เมื่อหมดเวลาให้ผู้สนับสนุนกด refund และตรวจว่ากดซ้ำไม่ได้
7. ตรวจ Events และ balances ด้วย Etherscan จากลิงก์ใน UI

ใช้ test ETH เท่านั้นและเผื่อ Gas ทุกบัญชี
