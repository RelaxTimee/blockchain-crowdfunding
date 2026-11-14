import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import './style.css';
import {
  ADDRESS,
  CHAIN_ID,
  EXPLORER,
  CrowdfundingClient,
  connectWallet,
  transact,
  type WalletOption,
  type Snapshot,
  type Details,
  type Activity,
} from './chain';
import {
  allocation,
  escape as esc,
  ether,
  ethAmount,
  errorText,
  percentage,
  permissions,
  phase,
  safeEvidence,
  short,
  validateCampaign,
  type Campaign,
  type MilestoneInput,
} from './domain';

const app = document.querySelector<HTMLDivElement>('#app')!;
const client = new CrowdfundingClient();
const wallets: WalletOption[] = [];
let wallet: WalletOption | undefined;
let account: string | undefined;
let walletChain: bigint | undefined;
let snapshot: Snapshot | undefined;
let selected: Campaign | undefined;
let details: Details | undefined;
let events: Activity[] = [];
let eventCursor = -1;
let eventEnd = 0;
let eventError = '';
let page = 0;
let loading = true;
let busy = false;
let historyLoading = false;
let stale = true;
let revision = 0;
let selectionRevision = 0;
let loadedAt = 0;
let loadError = '';
let txMessage = '';
let txHash = '';
let txStatus: 'info' | 'success' | 'error' = 'info';
let lastFocus: HTMLElement | null = null;
const labels = {
  funding: 'กำลังระดมทุน',
  successful: 'ถึงเป้าหมายแล้ว',
  failed: 'เปิดให้คืนเงิน',
  completed: 'สำเร็จครบทุกระยะ',
};
const eventNames: Record<string, string> = {
  CampaignCreated: 'สร้างโครงการ',
  Contributed: 'รับเงินสนับสนุน',
  MilestoneRequested: 'ส่งหลักฐานขอเบิก',
  MilestoneApproved: 'ลงคะแนนอนุมัติ',
  FundsReleased: 'จ่ายเงินให้เจ้าของ',
  Refunded: 'คืนเงินผู้สนับสนุน',
};
const arrow = '<span aria-hidden="true">↗</span>';
const external = (url: string, text: string, css = '') =>
  `<a class="${css}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ${arrow}</a>`;
function now(): bigint {
  return snapshot ? snapshot.timestamp + BigInt(Math.floor((Date.now() - loadedAt) / 1000)) : 0n;
}
function usableAccount(): string | undefined {
  return !stale && !busy && walletChain === CHAIN_ID ? account : undefined;
}
function disabled(allowed: boolean): string {
  return allowed ? '' : 'disabled';
}
function remaining(c: Campaign): string {
  const left = c.deadline - now();
  if (left < 0n) return 'สิ้นสุดการระดมทุน';
  if (left >= 86400n) return `เหลือ ${left / 86400n} วัน ${(left % 86400n) / 3600n} ชม.`;
  if (left >= 3600n) return `เหลือ ${left / 3600n} ชม. ${(left % 3600n) / 60n} นาที`;
  return `เหลือ ${left / 60n} นาที ${left % 60n} วินาที`;
}
function progress(c: Campaign): string {
  const width =
    c.goal > 0n
      ? Number(
          (c.totalRaised * 10000n) / c.goal > 10000n ? 10000n : (c.totalRaised * 10000n) / c.goal,
        ) / 100
      : 0;
  return `<div class="progress" role="progressbar" aria-label="ความคืบหน้าระดมทุน" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100"><i style="width:${width}%"></i></div>`;
}
function card(c: Campaign, index: number): string {
  const p = phase(c, now());
  return `<button class="campaign-card ${selected?.campaignId === c.campaignId ? 'selected' : ''}" data-select="${c.campaignId}" aria-pressed="${selected?.campaignId === c.campaignId}">
    <div class="card-top"><span class="project-icon icon-${index % 3}" aria-hidden="true">${['◈', '⌘', '✳'][index % 3]}</span><span class="badge ${p === 'failed' ? 'amber' : ''}">${labels[p]}</span></div>
    <span class="eyebrow">PROJECT / ${String(c.campaignId).padStart(3, '0')}</span><h3>${esc(c.name)}</h3>
    <div class="card-funding"><strong>${esc(ether(c.totalRaised))} <small>ETH</small></strong><span>${percentage(c.totalRaised, c.goal)}%</span></div>${progress(c)}
    <div class="card-foot"><span>เป้าหมาย ${esc(ether(c.goal))} ETH</span><span>${remaining(c)}</span></div>
  </button>`;
}
function render(): void {
  const openDialog = document.querySelector<HTMLDialogElement>('#create-dialog');
  const preservedDialog = openDialog?.open ? openDialog : undefined;
  preservedDialog?.remove();
  app.innerHTML = `<aside class="sidebar"><a href="#main" class="brand"><span class="brandmark" aria-hidden="true">▥</span>innovate<span>fund</span><i>.</i></a>
    <div class="workspace"><span class="workspace-icon">IF</span><div>พื้นที่ระดมทุน<small>Assignment 12 · Web3</small></div><span class="workspace-dot"></span></div>
    <span class="nav-label">WORKSPACE</span><nav aria-label="เมนูหลัก"><a class="nav-item active" href="#main"><span>▦</span>ภาพรวมโครงการ</a><button class="nav-item" data-action="create"><span>⊕</span>สร้างโครงการ</button><a class="nav-item" href="#detail"><span>◇</span>จัดการ Milestone</a><a class="nav-item" href="#transparency"><span>↔</span>ความโปร่งใสทางการเงิน</a></nav>
    <div class="sidebar-bottom"><div class="network-card"><span class="live-dot"></span> Ethereum Sepolia<small>เครือข่ายทดสอบ · ใช้ Test ETH เท่านั้น</small></div>${external(`${EXPLORER}/address/${ADDRESS}#code`, 'ดู Smart Contract', 'contract-link')}<div class="sidebar-footer">Built on trust.<br><strong>Verified on chain.</strong><span class="mini-cubes" aria-hidden="true">◇ ◇ ◇</span></div></div></aside>
    <div class="shell"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong>ภาพรวมโครงการ</strong></div><div class="wallet-controls"><span class="network-label"><span class="live-dot"></span>Sepolia Testnet</span><select id="wallet-choice" aria-label="เลือก Wallet" ${disabled(!busy)}>${wallets.length ? wallets.map((w) => `<option value="${esc(w.id)}" ${wallet?.id === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('') : '<option>MetaMask / EVM Wallet</option>'}</select><button class="button dark" data-action="connect" ${disabled(!busy)}>${account ? (walletChain === CHAIN_ID ? `◉ ${short(account)}` : 'เปลี่ยนเป็น Sepolia') : '◉ เชื่อมต่อ Wallet'}</button>${account ? '<button class="button ghost" data-action="disconnect" aria-label="ตัดการเชื่อมต่อในแอป">ออก</button>' : ''}</div></header>
    <main id="main"><div class="page-heading"><div><span class="eyebrow">THE FUTURE IS COLLECTIVE</span><h1>ไอเดียที่ดี เริ่มต้นได้ด้วยกัน<span>.</span></h1><p>สนับสนุนโครงการที่เชื่อมั่น ติดตามทุกความสำเร็จผ่านบล็อกเชน</p></div><button class="button dark" data-action="create">＋ สร้างโครงการใหม่</button></div>
    <section class="hero" aria-label="การระดมทุนตามความสำเร็จ"><div class="hero-copy"><span class="hero-tag"><span class="live-dot"></span> CROWDFUNDING, REIMAGINED</span><h2>ทุกการสนับสนุน<br>ขับเคลื่อน<span>ความเป็นไปได้</span></h2><p>เงินทุนถูกเก็บไว้ใน Smart Contract และทยอยจ่าย<br>เมื่อผู้สนับสนุนอนุมัติความสำเร็จของแต่ละ Milestone</p><a class="button lime" href="#campaigns">สำรวจโครงการ <span>↗</span></a><span class="hero-note">โปร่งใสทุกขั้นตอน · คุณมีส่วนตัดสินใจ</span></div><div class="hero-art" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><div class="art-label">IDEAS → IMPACT</div><div class="pillar p1"><i>01</i></div><div class="pillar p2"><i>02</i></div><div class="pillar p3"><i>03</i><span>↗</span></div><div class="art-bottom"><span>GROWTH, TOGETHER</span><b>100%<small>ON-CHAIN</small></b></div><span class="spark s1">✳</span><span class="spark s2">＋</span></div></section>
    <section class="stats" aria-label="ข้อมูลเครือข่าย"><article><span class="stat-icon">▦</span><div><span>โครงการทั้งหมด</span><strong>${snapshot?.total ?? '—'} <small>โครงการ</small></strong></div></article><article><span class="stat-icon">Ξ</span><div><span>ETH คงเหลือใน Contract</span><strong>${snapshot ? esc(ether(snapshot.balance)) : '—'} <small>ETH</small></strong></div></article><article><span class="stat-icon">✓</span><div><span>เกณฑ์อนุมัติถ่วงน้ำหนัก ETH</span><strong>&gt; ${snapshot?.threshold ?? 50n}<small>%</small></strong></div></article><article><span class="stat-icon">◇</span><div><span>ข้อมูลล่าสุดจากบล็อก</span><strong>${snapshot ? snapshot.block.toLocaleString('en-US') : '—'}</strong></div></article></section>
    <div id="notice" class="notice ${txStatus}" role="status" aria-live="polite" ${txMessage ? '' : 'hidden'}>${esc(txMessage)} ${txHash ? external(`${EXPLORER}/tx/${txHash}`, 'ดูธุรกรรม') : ''}</div>
    ${loadError ? `<div class="notice error" role="alert">${esc(loadError)} <button class="text-button" data-action="retry">ลองเชื่อมต่อใหม่</button></div>` : ''}
    <section id="campaigns"><div class="section-heading"><div><h2>ค้นพบโครงการ<span class="count">${snapshot?.total ?? '—'}</span></h2><p>จากไอเดียสู่ผลลัพธ์ที่จับต้องได้</p></div><button class="button outline" data-action="refresh" ${disabled(!loading && !busy)}>↻ รีเฟรชข้อมูล</button></div><div class="campaign-grid">${loading && !snapshot ? '<div class="empty-state"><span class="spinner"></span><h3>กำลังอ่านข้อมูลจาก Sepolia</h3><p>กำลังตรวจสอบ Contract และยอดระดมทุนจริง</p></div>' : snapshot?.campaigns.length ? snapshot.campaigns.map(card).join('') : `<div class="empty-state"><span class="empty-symbol">◈</span><h3>${loadError ? 'ยังอ่านข้อมูลโครงการไม่ได้' : 'พื้นที่สำหรับไอเดียถัดไปของคุณ'}</h3><p>${loadError ? 'ตรวจสอบอินเทอร์เน็ตแล้วกดลองเชื่อมต่อใหม่' : 'ยังไม่มีโครงการบน Contract นี้ เริ่มสร้างโครงการแรกได้เลย'}</p><button class="button dark" data-action="${loadError ? 'retry' : 'create'}">${loadError ? 'ลองอีกครั้ง' : '＋ สร้างโครงการแรก'}</button></div>`}</div>
    <div class="pagination"><span>${snapshot ? `แสดง ${snapshot.campaigns.length} โครงการ · หน้า ${page + 1}` : 'ข้อมูลจริงจาก Ethereum Sepolia'}</span><div><button class="button ghost" data-action="prev" ${disabled(page > 0 && !loading)}>← ใหม่กว่า</button><button class="button ghost" data-action="next" ${disabled(!!snapshot && BigInt((page + 1) * 6) < snapshot.total && !loading)}>เก่ากว่า →</button></div></div></section>
    <section id="detail">${renderDetail()}</section>
    <section class="trust-strip"><span class="trust-icon">◇</span><div><h3>การตัดสินใจอยู่กับผู้สนับสนุน</h3><p>เจ้าของโครงการถอนเงินเองไม่ได้ · ต้องอนุมัติเกิน ${snapshot?.threshold ?? 50n}% · เบิกตามลำดับระยะงาน</p></div>${external(`${EXPLORER}/address/${ADDRESS}#code`, 'ตรวจสอบโค้ดสัญญา')}</section>
    <footer class="footer"><span>© ${new Date().getFullYear()} InnovateFund <i>·</i> Assignment 12: Blockchain Crowdfunding</span><span><span class="live-dot"></span> Sepolia Testnet · Test ETH only</span></footer></main></div>
    <dialog id="create-dialog" aria-labelledby="create-title"><form id="create-form"><div class="dialog-heading"><div><span class="eyebrow">MAKE AN IDEA HAPPEN</span><h2 id="create-title">สร้างโครงการระดมทุน</h2></div><button type="button" class="close-button" data-action="close" aria-label="ปิด">×</button></div><p class="muted">บันทึกข้อมูลและสัดส่วน Milestone บน Sepolia ข้อมูลแก้ไขไม่ได้หลังสร้าง</p><label>ชื่อโครงการ<input name="name" required maxlength="160" placeholder="โครงการนวัตกรรมของคุณ" /></label><div class="form-grid"><label>เป้าหมาย (ETH)<input name="goal" required inputmode="decimal" placeholder="0.1" /></label><label>ระยะเวลาระดมทุน (นาที)<input name="duration" required type="number" min="1" max="5256000" step="1" value="1440" /></label></div><div class="section-heading compact"><h3>แผนการดำเนินงาน</h3><button class="text-button" type="button" data-action="add-row">＋ เพิ่ม Milestone</button></div><p class="muted">1–10 ระยะ · สัดส่วนรวม 100% · จ่ายตามยอดที่ระดมได้จริง</p><div id="milestone-rows">${milestoneRow(1, '100')}</div><p id="create-error" class="form-error" role="alert"></p><div class="dialog-footer"><span>ต้องเชื่อมต่อ Wallet และมี Sepolia ETH สำหรับ Gas</span><button class="button dark" type="submit">สร้างโครงการบนบล็อกเชน ↗</button></div></form></dialog>`;
  if (preservedDialog) {
    document.querySelector('#create-dialog')?.replaceWith(preservedDialog);
    // Removing a modal clears its top-layer state. Restore it with entered values intact.
    preservedDialog.close();
    preservedDialog.showModal();
  }
}
function renderDetail(): string {
  const c = selected;
  if (!c) return '';
  if (!details)
    return `<div class="detail-panel empty-state"><span class="spinner"></span><p>กำลังอ่านรายละเอียดโครงการ #${c.campaignId}</p></div>`;
  const phaseName = phase(c, now(), details.milestones.length);
  const first = details.milestones[0];
  const rights = first
    ? permissions(
        c,
        first,
        0,
        usableAccount(),
        details.contribution,
        details.votes[0] ?? false,
        now(),
      )
    : { contribute: false, refund: false };
  return `<div class="section-heading"><div><span class="eyebrow">PROJECT DETAILS / ${String(c.campaignId).padStart(3, '0')}</span><h2>${esc(c.name)}</h2></div><span class="badge ${phaseName === 'failed' ? 'amber' : ''}">${labels[phaseName]}</span></div><div class="detail-layout"><div class="milestones-panel"><div class="panel-heading"><h3>เส้นทางสู่ความสำเร็จ</h3><span>${c.releasedCount}/${details.milestones.length} ระยะสำเร็จ</span></div><p class="muted">คะแนนอนุมัติคิดตาม ETH ที่สนับสนุน ต้องเกิน ${snapshot!.threshold}% จึงจะโอนเงินอัตโนมัติ</p><div class="milestones">${details.milestones
    .map((m, i) => {
      const can = permissions(
        c,
        m,
        i,
        usableAccount(),
        details!.contribution,
        details!.votes[i] ?? false,
        now(),
      );
      const amount =
        m.status === 2 ? m.amountReleased : allocation(c, m, i, details!.milestones.length);
      const link = safeEvidence(m.evidence);
      return `<article class="milestone"><span class="step ${m.status === 2 ? 'done' : ''}">${m.status === 2 ? '✓' : String(i + 1).padStart(2, '0')}</span><div class="milestone-body"><div class="milestone-heading"><h4>${esc(m.description || `Milestone ${i + 1}`)}</h4><span class="badge ${m.status === 1 ? 'amber' : 'neutral'}">${['รอเริ่มดำเนินงาน', 'รอผู้สนับสนุนอนุมัติ', 'จ่ายเงินแล้ว'][m.status] ?? 'ไม่ทราบสถานะ'}</span></div><p>สัดส่วน ${m.percent}% <span class="separator">·</span> ${esc(ether(amount))} ETH${m.status !== 2 ? ' (ยอดจัดสรรปัจจุบัน)' : ''}</p>${m.evidence ? `<div class="evidence"><span>หลักฐานความสำเร็จ</span><p>${esc(m.evidence)}</p>${link ? external(link, 'เปิดหลักฐาน HTTPS') : ''}</div>` : ''}${m.status > 0 ? `<p class="vote-weight">น้ำหนักอนุมัติ ${percentage(m.approvalWeight, c.totalRaised)}% · ${esc(ether(m.approvalWeight))} / ${esc(ether(c.totalRaised))} ETH${details!.votes[i] ? ' · คุณลงคะแนนแล้ว' : ''}</p>` : ''}${can.request ? `<form class="evidence-form" data-index="${i}"><label>หลักฐานความสำเร็จ (ข้อความ หรือ HTTPS/IPFS URI)<textarea name="evidence" required maxlength="4000" rows="2" placeholder="อธิบายผลงานและแนบลิงก์หลักฐาน"></textarea></label><button class="button dark small" type="submit">ส่งหลักฐานขอเบิก ↗</button></form>` : ''}${m.status === 1 ? `<button class="button dark small" data-approve="${i}" ${disabled(can.approve)}>${details!.votes[i] ? '✓ ลงคะแนนแล้ว' : 'อนุมัติการจ่ายเงิน'}</button>` : ''}</div></article>`;
    })
    .join(
      '',
    )}</div></div><aside class="funding-panel"><span class="eyebrow">FUND THIS IDEA</span><h3>${esc(ether(c.totalRaised))} <small>ETH</small></h3><p>จากเป้าหมาย ${esc(ether(c.goal))} ETH</p>${progress(c)}<div class="funding-meta"><strong>${percentage(c.totalRaised, c.goal)}%</strong><span data-countdown>${remaining(c)}</span></div><dl class="ledger"><div><dt>เงินที่จ่ายแล้ว</dt><dd>${esc(ether(c.totalReleased))} ETH</dd></div><div><dt>เงินที่คืนแล้ว</dt><dd>${esc(ether(c.totalRefunded))} ETH</dd></div><div><dt>เงินคงเหลือโครงการ</dt><dd>${esc(ether(c.totalRaised - c.totalReleased - c.totalRefunded))} ETH</dd></div><div><dt>ยอดสนับสนุนของคุณ</dt><dd>${account ? `${esc(ether(details.contribution))} ETH` : 'เชื่อมต่อ Wallet'}</dd></div></dl><form id="contribute-form"><label>จำนวนที่ต้องการสนับสนุน (ETH)<input name="amount" inputmode="decimal" required placeholder="0.01" ${disabled(rights.contribute)} /></label><button class="button dark full" type="submit" ${disabled(rights.contribute)}>สนับสนุนโครงการ ${arrow}</button></form>${!account ? '<p class="form-hint">เชื่อมต่อ Wallet เพื่อสนับสนุนหรือลงคะแนน</p>' : account.toLowerCase() === c.creator.toLowerCase() ? '<p class="form-hint">คุณเป็นเจ้าของโครงการ จึงสนับสนุนโครงการนี้ไม่ได้</p>' : walletChain !== CHAIN_ID ? '<p class="form-hint">เปลี่ยน Wallet เป็นเครือข่าย Sepolia</p>' : stale ? '<p class="form-hint">ข้อมูลยังไม่พร้อม กรุณารีเฟรชก่อนทำรายการ</p>' : phaseName !== 'funding' ? '<p class="form-hint">โครงการสิ้นสุดการระดมทุนแล้ว</p>' : ''}${phaseName === 'failed' ? `<div class="refund-box"><h4>โครงการไม่ถึงเป้าหมาย</h4><p>ขอคืนยอดสนับสนุนเต็มจำนวนได้ โดยชำระ Gas แยกต่างหาก</p><button class="button outline full" data-action="refund" ${disabled(rights.refund)}>ขอคืนเงิน ${esc(ether(details.contribution))} ETH</button></div>` : ''}<div class="owner-info"><span>เจ้าของโครงการ</span>${external(`${EXPLORER}/address/${c.creator}`, short(c.creator))}<small>สิ้นสุด: ${esc(new Date(Number(c.deadline) * 1000).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</small></div></aside></div>
    <div id="transparency" class="history-panel"><div class="panel-heading"><div><span class="eyebrow">ON-CHAIN ACTIVITY</span><h3>ทุกการเคลื่อนไหว ตรวจสอบได้</h3></div><span class="badge neutral">โครงการ #${c.campaignId}</span></div><p class="muted">ยอดข้างต้นมาจากสถานะ Contract โดยตรง · ประวัติจาก Events ${eventEnd ? `ตรวจถึงบล็อก ${eventEnd.toLocaleString('en-US')}` : 'กำลังโหลด'}${eventCursor >= client.creationBlock ? ` · ยังมีประวัติก่อนบล็อก ${(eventCursor + 1).toLocaleString('en-US')}` : eventEnd ? ' · ครบถึงบล็อกที่ deploy แล้ว' : ''}</p>${eventError ? `<p class="form-error" role="alert">${esc(eventError)} ประวัติยังโหลดไม่ครบ กดโหลดประวัติเพื่อลองใหม่</p>` : ''}<div class="table-wrap"><table><thead><tr><th>รายการ</th><th>ผู้ทำรายการ</th><th>จำนวนเงิน / ระยะงาน</th><th>บล็อก</th><th>หลักฐานธุรกรรม</th></tr></thead><tbody>${events.length ? events.map((e) => `<tr><td><span class="event-dot ${e.name === 'FundsReleased' || e.name === 'Refunded' ? 'outgoing' : ''}"></span>${esc(eventNames[e.name] ?? e.name)}</td><td>${e.actor ? external(`${EXPLORER}/address/${e.actor}`, short(e.actor)) : '—'}</td><td>${e.amount !== undefined ? `${esc(ether(e.amount))} ETH` : e.milestone !== undefined ? `Milestone ${e.milestone + 1n}` : '—'}</td><td>${e.block.toLocaleString('en-US')}</td><td>${external(`${EXPLORER}/tx/${e.hash}`, short(e.hash))}</td></tr>`).join('') : `<tr><td colspan="5" class="table-empty">${historyLoading ? 'กำลังโหลดประวัติธุรกรรม…' : 'ไม่พบ Event ในช่วง block ที่ตรวจแล้ว'}</td></tr>`}</tbody></table></div><button class="button ghost" data-action="history" ${disabled(!historyLoading && eventCursor >= client.creationBlock)}>${historyLoading ? 'กำลังตรวจสอบประวัติ…' : 'โหลดประวัติเก่าเพิ่ม (สูงสุด 10,000 บล็อก)'}</button></div>`;
}
function milestoneRow(index: number, percent = ''): string {
  return `<div class="milestone-row"><span>${String(index).padStart(2, '0')}</span><label>รายละเอียดระยะงาน<input name="description" required maxlength="500" placeholder="เช่น พัฒนาต้นแบบและทดสอบ" /></label><label>สัดส่วน (%)<input name="percent" type="number" min="1" max="100" step="1" required value="${percent}" /></label><button class="close-button" type="button" data-action="remove-row" aria-label="ลบ Milestone">×</button></div>`;
}
function notice(message: string, status: typeof txStatus = 'info', hash = ''): void {
  txMessage = message;
  txStatus = status;
  txHash = hash;
  const node = document.querySelector<HTMLElement>('#notice');
  if (node) {
    node.hidden = false;
    node.className = `notice ${status}`;
    node.innerHTML = `${esc(message)} ${hash ? external(`${EXPLORER}/tx/${hash}`, 'ดูธุรกรรม') : ''}`;
  }
}
async function loadHistory(reset = false): Promise<void> {
  if (!selected || !snapshot || historyLoading) return;
  const id = selected.campaignId;
  const stamp = selectionRevision;
  if (reset) {
    events = [];
    eventEnd = snapshot.block;
    eventCursor = snapshot.block;
  }
  if (eventCursor < client.creationBlock) return;
  historyLoading = true;
  eventError = '';
  renderDetailOnly();
  try {
    const result = await client.activity(id, eventCursor);
    if (stamp !== selectionRevision) return;
    const unique = new Map([...events, ...result.events].map((e) => [`${e.hash}:${e.index}`, e]));
    events = [...unique.values()].sort((a, b) => b.block - a.block || b.index - a.index);
    eventCursor = result.next;
  } catch (e) {
    if (stamp === selectionRevision) eventError = errorText(e);
  } finally {
    if (stamp === selectionRevision) {
      historyLoading = false;
      renderDetailOnly();
    }
  }
}
function renderDetailOnly(): void {
  // Do not replace focused transaction forms during background history loading.
  if (document.activeElement?.closest('.evidence-form, #contribute-form')) return;
  const section = document.querySelector('#detail');
  if (section) section.innerHTML = renderDetail();
}
async function selectCampaign(c: Campaign): Promise<void> {
  const stamp = ++selectionRevision;
  selected = c;
  details = undefined;
  events = [];
  eventEnd = 0;
  eventCursor = -1;
  eventError = '';
  historyLoading = false;
  render();
  try {
    const result = await client.details(
      c.campaignId,
      walletChain === CHAIN_ID ? account : undefined,
      snapshot!.block,
    );
    if (stamp !== selectionRevision) return;
    details = result;
    render();
    void loadHistory(true);
  } catch (e) {
    if (stamp === selectionRevision) {
      stale = true;
      notice(`อ่านรายละเอียดไม่สำเร็จ: ${errorText(e)}`, 'error');
    }
  }
}
async function refresh(reopen = false): Promise<void> {
  const stamp = ++revision;
  loading = true;
  try {
    if (reopen || !client.provider) await client.open();
    const result = await client.snapshot(page);
    if (stamp !== revision) return;
    snapshot = result;
    loadedAt = Date.now();
    stale = false;
    loadError = '';
    loading = false;
    const next =
      result.campaigns.find((c) => c.campaignId === selected?.campaignId) ?? result.campaigns[0];
    if (next) await selectCampaign(next);
    else {
      selectionRevision++;
      selected = undefined;
      details = undefined;
      render();
    }
  } catch (e) {
    if (stamp === revision) {
      stale = true;
      loadError = errorText(e);
      loading = false;
      render();
    }
  }
}
async function runTransaction(
  method: string,
  args: readonly unknown[],
  value?: bigint,
): Promise<void> {
  if (busy) return;
  if (!wallet || !account || walletChain !== CHAIN_ID) {
    notice('กรุณาเชื่อมต่อ Wallet บนเครือข่าย Sepolia', 'error');
    return;
  }
  busy = true;
  render();
  notice('กำลังตรวจสอบรายการ กรุณายืนยันใน Wallet');
  try {
    const receipt = await transact(
      wallet.provider,
      account,
      method,
      args,
      (hash) => notice('ส่งธุรกรรมแล้ว กำลังรอการยืนยันบน Sepolia…', 'info', hash),
      value,
    );
    notice('ยืนยันธุรกรรมสำเร็จแล้ว', 'success', receipt.hash);
    // Public RPCs can lag behind the wallet RPC. Wait for the receipt block before reading.
    for (let attempt = 0; attempt < 12; attempt++) {
      if ((await client.provider!.getBlockNumber()) >= receipt.blockNumber) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (attempt === 11) throw new Error('ธุรกรรมสำเร็จ แต่ RPC อ่านข้อมูลยังตามไม่ทัน กรุณารีเฟรชอีกครั้ง');
    }
    if (method === 'createCampaign') {
      page = 0;
      selected = undefined;
    }
  } catch (e) {
    notice(errorText(e), 'error', txHash);
  } finally {
    busy = false;
    await refresh();
  }
}
const walletChanged = (): void => {
  void syncWallet();
};
const walletDisconnected = (): void => {
  walletRevision++;
  account = undefined;
  walletChain = undefined;
  stale = true;
  details = undefined;
  render();
  void refresh();
};
let walletRevision = 0;
function chooseWallet(id: string): void {
  if (busy) return;
  wallet?.provider.removeListener?.('accountsChanged', walletChanged);
  wallet?.provider.removeListener?.('chainChanged', walletChanged);
  wallet?.provider.removeListener?.('disconnect', walletDisconnected);
  wallet = wallets.find((w) => w.id === id);
  account = undefined;
  walletChain = undefined;
  wallet?.provider.on?.('accountsChanged', walletChanged);
  wallet?.provider.on?.('chainChanged', walletChanged);
  wallet?.provider.on?.('disconnect', walletDisconnected);
  void syncWallet();
}
async function syncWallet(): Promise<void> {
  const stamp = ++walletRevision;
  const active = wallet;
  if (!active) return;
  try {
    const [accounts, chain] = await Promise.all([
      active.provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
      active.provider.request({ method: 'eth_chainId' }) as Promise<string>,
    ]);
    if (stamp !== walletRevision || active !== wallet) return;
    account = accounts[0];
    walletChain = BigInt(chain);
    // Never display permissions or contribution totals belonging to the previous account.
    stale = true;
    details = undefined;
    if (!busy) render();
    if (snapshot && !busy) await refresh();
    else if (!busy) render();
  } catch (e) {
    if (stamp === walletRevision) {
      account = undefined;
      walletChain = undefined;
      notice(errorText(e), 'error');
    }
  }
}
function addWallet(option: WalletOption): void {
  if (wallets.some((w) => w.provider === option.provider || w.id === option.id)) return;
  wallets.push(option);
  if (!wallet) chooseWallet(option.id);
  if (!document.querySelector<HTMLDialogElement>('#create-dialog')?.open && !busy) render();
}
window.addEventListener('eip6963:announceProvider', ((
  event: CustomEvent<{ info: { uuid: string; name: string }; provider: WalletOption['provider'] }>,
) => {
  addWallet({
    id: event.detail.info.uuid,
    name: event.detail.info.name,
    provider: event.detail.provider,
  });
}) as EventListener);
window.dispatchEvent(new Event('eip6963:requestProvider'));
if (window.ethereum) {
  for (const [i, provider] of (window.ethereum.providers ?? [window.ethereum]).entries())
    addWallet({
      id: `injected-${i}`,
      name: provider.isMetaMask ? 'MetaMask' : 'EVM Wallet',
      provider,
    });
}
app.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.id === 'wallet-choice') chooseWallet(target.value);
});
app.addEventListener('click', async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button, [data-select]');
  if (!target || target.hasAttribute('disabled')) return;
  const action = target.dataset.action;
  if (target.dataset.select && snapshot && !busy) {
    const campaign = snapshot.campaigns.find(
      (c) => c.campaignId === BigInt(target.dataset.select!),
    );
    if (campaign) await selectCampaign(campaign);
  } else if (target.dataset.approve && selected && !busy) {
    await runTransaction('approveMilestone', [selected.campaignId, BigInt(target.dataset.approve)]);
  } else if (action === 'create') {
    if (busy) return;
    lastFocus = target;
    const dialog = document.querySelector<HTMLDialogElement>('#create-dialog')!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus();
  } else if (action === 'close') {
    document.querySelector<HTMLDialogElement>('#create-dialog')?.close();
    lastFocus?.focus();
  } else if (action === 'add-row') {
    const rows = document.querySelector('#milestone-rows')!;
    if (rows.children.length < 10)
      rows.insertAdjacentHTML('beforeend', milestoneRow(rows.children.length + 1));
  } else if (action === 'remove-row') {
    if (document.querySelector('#milestone-rows')!.children.length > 1)
      target.closest('.milestone-row')?.remove();
  } else if (action === 'connect') {
    if (!wallet) {
      notice('ไม่พบ Wallet กรุณาติดตั้ง MetaMask หรือเปิดเว็บในเบราว์เซอร์ Wallet', 'error');
      return;
    }
    busy = true;
    target.setAttribute('disabled', '');
    try {
      account = await connectWallet(wallet.provider);
      walletChain = CHAIN_ID;
      notice('เชื่อมต่อ Wallet บน Sepolia แล้ว', 'success');
    } catch (e) {
      notice(errorText(e), 'error');
    } finally {
      busy = false;
      await refresh();
    }
  } else if (action === 'disconnect') {
    walletRevision++;
    account = undefined;
    walletChain = undefined;
    notice('ตัดการเชื่อมต่อในแอปแล้ว สิทธิ์ Wallet จัดการได้ในส่วนขยาย');
    await refresh();
  } else if (action === 'refresh' || action === 'retry') {
    await refresh(action === 'retry');
  } else if (action === 'next' || action === 'prev') {
    page += action === 'next' ? 1 : -1;
    await refresh();
  } else if (action === 'history') {
    await loadHistory();
  } else if (action === 'refund' && selected) {
    await runTransaction('refund', [selected.campaignId]);
  }
});
app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  try {
    if (form.id === 'create-form') {
      const descriptions = data.getAll('description').map(String);
      const percents = data.getAll('percent').map(String);
      const rows: MilestoneInput[] = descriptions.map((description, i) => ({
        description,
        percent: percents[i] ?? '',
      }));
      const draft = validateCampaign(
        String(data.get('name') ?? ''),
        String(data.get('goal') ?? ''),
        String(data.get('duration') ?? ''),
        rows,
      );
      if (!account || walletChain !== CHAIN_ID)
        throw new Error('กรุณาปิดแบบฟอร์มและเชื่อมต่อ Wallet บน Sepolia ก่อน');
      document.querySelector<HTMLDialogElement>('#create-dialog')?.close();
      await runTransaction('createCampaign', [
        draft.name,
        draft.goal,
        draft.duration,
        draft.descriptions,
        draft.percents,
      ]);
    } else if (form.id === 'contribute-form' && selected) {
      const amount = ethAmount(String(data.get('amount') ?? ''));
      await runTransaction('contribute', [selected.campaignId], amount);
    } else if (form.matches('.evidence-form') && selected) {
      const evidence = String(data.get('evidence') ?? '').trim();
      if (!evidence) throw new Error('กรุณาระบุหลักฐานความสำเร็จ');
      await runTransaction('requestRelease', [
        selected.campaignId,
        BigInt(form.dataset.index!),
        evidence,
      ]);
    }
  } catch (e) {
    if (form.id === 'create-form')
      document.querySelector('#create-error')!.textContent = errorText(e);
    else notice(errorText(e), 'error');
  }
});
document.addEventListener('visibilitychange', () => {
  if (
    !document.hidden &&
    !busy &&
    !loading &&
    !document.querySelector<HTMLDialogElement>('#create-dialog')?.open
  )
    void refresh();
});
setInterval(() => {
  if (
    !snapshot ||
    busy ||
    loading ||
    document.hidden ||
    document.querySelector<HTMLDialogElement>('#create-dialog')?.open ||
    document.activeElement?.closest('form')
  )
    return;
  void refresh();
}, 30000);
render();
void refresh();
