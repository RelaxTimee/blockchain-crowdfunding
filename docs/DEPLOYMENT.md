# Git และ GitHub Pages ทีละขั้นตอน

Repository จริงคือ [RelaxTimee/blockchain-crowdfunding](https://github.com/RelaxTimee/blockchain-crowdfunding) และตั้งค่า Pages แบบ GitHub Actions แล้ว เว็บไซต์อยู่ที่ [InnovateFund](https://relaxtimee.github.io/blockchain-crowdfunding/) ดูสถานะ deployment ล่าสุดได้ที่ [Actions](https://github.com/RelaxTimee/blockchain-crowdfunding/actions/workflows/pages.yml)

คำสั่งด้านล่างใช้ PowerShell บน Windows และอธิบายขั้นตอนตั้งแต่เริ่มต้นสำหรับนำไปใช้ซ้ำ ใน checkout นี้มี Git และ remote อยู่แล้ว สามารถใช้ขั้นตอนอัปเดตเว็บภายหลังได้เลย

## 1. ตรวจงานในเครื่อง

```powershell
Set-Location -LiteralPath 'D:\Team DATA\CSI301\blockchain-crowdfunding'
npm ci
npm test
npm run build
npm run preview
```

เปิด URL ที่ preview แสดง เมื่อตรวจเสร็จหยุดด้วย `Ctrl+C`

## 2. สร้าง repository บน GitHub

1. เข้าสู่ระบบ GitHub เลือก **New repository**
2. ตั้งชื่อ `blockchain-crowdfunding`
3. เลือก **Public** สำหรับใช้ GitHub Pages กับ GitHub Free
4. ไม่เลือกสร้าง README, `.gitignore` หรือ License เพิ่ม เพราะมีในโฟลเดอร์แล้ว
5. กด **Create repository** แล้วคัดลอก HTTPS URL เช่น `https://github.com/YOUR_USERNAME/blockchain-crowdfunding.git`

## 3. Initialize, commit และ push

แทน `YOUR_USERNAME` ด้วยชื่อบัญชีจริงก่อนรัน ห้าม push ทั้งโฟลเดอร์ `CSI301` เพราะมีโปรเจกต์อื่น

```powershell
Set-Location -LiteralPath 'D:\Team DATA\CSI301\blockchain-crowdfunding'
git init -b main
git status --short
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "feat: add Sepolia crowdfunding frontend with milestone management"
git remote add origin https://github.com/YOUR_USERNAME/blockchain-crowdfunding.git
git push -u origin main
```

หาก Git ขอชื่อและอีเมล ให้กำหนดเฉพาะ repository นี้ด้วยข้อมูลจริง แล้วรัน commit อีกครั้ง:

```powershell
git config user.name "YOUR_NAME"
git config user.email "YOUR_GITHUB_EMAIL_OR_NOREPLY_EMAIL"
git commit -m "feat: add Sepolia crowdfunding frontend with milestone management"
git push -u origin main
```

GitHub ไม่ใช้รหัสผ่านบัญชีกับ HTTPS Git ให้ลงชื่อเข้าใช้ผ่าน Git Credential Manager ตาม prompt และอย่าฝัง token ใน remote URL

หากโฟลเดอร์มี Git อยู่แล้ว ไม่ต้อง `git init` ซ้ำ ให้ตรวจ `git status`, `git branch --show-current`, `git remote -v` ก่อน สำหรับ remote ที่มีอยู่และต้องการเปลี่ยน ให้ใช้ `git remote set-url origin <URLจริง>` โดยไม่ force push

## 4. เปิด GitHub Pages ผ่าน Actions

1. เปิด repository → **Settings → Pages**
2. ใต้ **Build and deployment → Source** เลือก **GitHub Actions**
3. เปิดแท็บ **Actions** → workflow **Check and deploy GitHub Pages**
4. ถ้า workflow แรกจากการ push ล้มเหลวเพราะยังไม่ได้เปิด Pages ให้เลือก **Re-run all jobs** หรือใช้ **Run workflow** บน branch `main`
5. รอ jobs `build` และ `deploy` ผ่าน จากนั้นเปิด URL ในผลของ deployment
6. สำหรับ repository ชื่อนี้ URL ปกติคือ `https://YOUR_USERNAME.github.io/blockchain-crowdfunding/` (ใช้ URL จริงจาก job เป็นหลัก)

Workflow ที่มีให้ใช้ Node.js 22, `npm ci`, `npm test`, `npm run build`, upload `dist/` และ `actions/deploy-pages` พร้อม `pages: write`, `id-token: write` และ environment `github-pages` ตาม [เอกสาร GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

ตั้ง `base: './'` ใน Vite แล้ว จึงโหลด asset ได้ทั้ง root domain และ path `/blockchain-crowdfunding/` ไม่ต้องแก้ชื่อ repository ใน source code ไม่มี client router ที่ต้องตั้ง fallback routes

ไม่เลือก **Deploy from a branch** สำหรับ workflow นี้ เพราะ source TypeScript ต้อง build ก่อน และ `dist/` ถูก ignore ไว้

## 5. RPC แบบกำหนดเอง (ถ้าจำเป็น)

ค่าเริ่มต้นใช้ public Sepolia RPC ได้ทันที หากติด rate limit:

1. ไปที่ **Settings → Secrets and variables → Actions → Variables**
2. เพิ่ม repository variable `VITE_SEPOLIA_RPC_URL` เป็น public/browser-restricted Sepolia RPC URL ที่รองรับ CORS
3. รัน workflow อีกครั้ง

URL นี้อยู่ใน browser bundle ทุกคนอ่านได้ ห้ามใช้ private keys, seed phrases หรือ confidential credentials หากผู้ให้บริการมี key ควรจำกัด origin และสิทธิ์ให้เหมาะกับเว็บสาธารณะ

## 6. อัปเดตเว็บภายหลัง

```powershell
Set-Location -LiteralPath 'D:\Team DATA\CSI301\blockchain-crowdfunding'
npm test
npm run build
git status --short
git add .
git diff --cached --check
git commit -m "fix: describe the actual change"
git push
```

Push เข้า `main` จะตรวจและ deploy รุ่นใหม่อัตโนมัติ หาก tests/build ไม่ผ่าน job deploy จะไม่ทำงาน

สำหรับงานร่วมกัน แนะนำสร้าง branch และ PR:

```powershell
git switch -c feat/your-change
git add .
git commit -m "feat: describe the actual change"
git push -u origin feat/your-change
```

เปิด PR ไป `main`; workflow ตรวจ tests/build แต่ไม่ deploy จาก PR จากนั้น review และ merge เมื่อผ่าน

## ตรวจหลัง deploy

- เปิด URL ผ่าน HTTPS และ hard refresh หากเห็น asset เก่า
- ตรวจว่าอ่านข้อมูล Sepolia ได้โดยไม่ต่อ Wallet
- เชื่อม Wallet และตรวจ chain เป็น Sepolia; ใช้ test ETH เท่านั้น
- ถ้าจำนวนโครงการเป็น 0 โดยไม่มี error แปลว่า Contract ยังไม่มีโครงการ ไม่ใช่ deployment ล้มเหลว
- ถ้าหน้าขาว ให้ตรวจ Actions build log และ browser console; ต้อง upload `dist/` ทั้งโฟลเดอร์
- ถ้า 404 ให้ตรวจ Source = GitHub Actions, branch `main`, workflow run และ URL จาก deploy job
- ตั้ง branch protection/Require status checks และ Dependabot ตามนโยบายของ repository เพื่อดูแล dependency ต่อเนื่อง
