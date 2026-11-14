import { formatEther, parseEther } from 'ethers';

export interface Campaign {
  campaignId: bigint;
  creator: string;
  name: string;
  goal: bigint;
  deadline: bigint;
  totalRaised: bigint;
  totalReleased: bigint;
  totalRefunded: bigint;
  releasedCount: bigint;
}
export interface Milestone {
  description: string;
  percent: bigint;
  evidence: string;
  approvalWeight: bigint;
  amountReleased: bigint;
  status: number;
}
export interface MilestoneInput {
  description: string;
  percent: string;
}
export type CampaignPhase = 'funding' | 'successful' | 'failed' | 'completed';

export function phase(c: Campaign, now: bigint, count = 0): CampaignPhase {
  if (now <= c.deadline) return 'funding';
  if (c.totalRaised < c.goal) return 'failed';
  return c.totalReleased === c.totalRaised || (count > 0 && c.releasedCount === BigInt(count))
    ? 'completed'
    : 'successful';
}
export function ethAmount(input: string): bigint {
  const value = input.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))
    throw new Error('กรอก ETH เป็นเลขทศนิยมไม่เกิน 18 ตำแหน่ง');
  const wei = parseEther(value);
  if (wei <= 0n || wei >= 2n ** 256n)
    throw new Error('จำนวน ETH ต้องมากกว่า 0 และอยู่ในขอบเขต uint256');
  return wei;
}
export function validateCampaign(
  name: string,
  goal: string,
  duration: string,
  rows: MilestoneInput[],
) {
  if (!name.trim()) throw new Error('กรุณาระบุชื่อโครงการ');
  const goalWei = ethAmount(goal);
  if (!/^[1-9]\d*$/.test(duration) || BigInt(duration) > 5256000n)
    throw new Error('ระยะเวลาต้องเป็นจำนวนนาทีเต็ม ตั้งแต่ 1 ถึง 5,256,000');
  if (rows.length < 1 || rows.length > 10) throw new Error('ต้องมี Milestone 1–10 ระยะ');
  const percents = rows.map((row) => {
    if (!row.description.trim()) throw new Error('กรุณาระบุรายละเอียดของทุก Milestone');
    if (!/^[1-9]\d*$/.test(row.percent) || BigInt(row.percent) > 100n)
      throw new Error('สัดส่วนแต่ละระยะต้องเป็นจำนวนเต็ม 1–100%');
    return BigInt(row.percent);
  });
  if (percents.reduce((a, b) => a + b, 0n) !== 100n)
    throw new Error('สัดส่วน Milestone รวมต้องเท่ากับ 100%');
  return {
    name: name.trim(),
    goal: goalWei,
    duration: BigInt(duration),
    descriptions: rows.map((r) => r.description.trim()),
    percents,
  };
}
export function permissions(
  c: Campaign,
  m: Milestone,
  index: number,
  account: string | undefined,
  contribution: bigint,
  voted: boolean,
  now: bigint,
) {
  const creator = account?.toLowerCase() === c.creator.toLowerCase();
  return {
    contribute: !!account && !creator && now <= c.deadline,
    request:
      !!account &&
      creator &&
      now > c.deadline &&
      c.totalRaised >= c.goal &&
      m.status === 0 &&
      BigInt(index) === c.releasedCount,
    approve: !!account && contribution > 0n && m.status === 1 && !voted,
    refund: !!account && now > c.deadline && c.totalRaised < c.goal && contribution > 0n,
  };
}
export function approved(weight: bigint, raised: bigint, threshold: bigint): boolean {
  return weight * 100n > raised * threshold;
}
export function allocation(c: Campaign, m: Milestone, index: number, count: number): bigint {
  return index === count - 1 && BigInt(index) === c.releasedCount
    ? c.totalRaised - c.totalReleased
    : (c.totalRaised * m.percent) / 100n;
}
export function percentage(part: bigint, total: bigint): string {
  return total > 0n
    ? `${(part * 10000n) / total / 100n}.${String(((part * 10000n) / total) % 100n).padStart(2, '0')}`
    : '0.00';
}
export function ether(value: bigint): string {
  return formatEther(value);
}
export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
export function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function safeEvidence(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as {
      code?: unknown;
      reason?: unknown;
      shortMessage?: unknown;
      message?: unknown;
      info?: { error?: { code?: unknown } };
    };
    if (e.code === 4001 || e.code === 'ACTION_REJECTED' || e.info?.error?.code === 4001)
      return 'คุณยกเลิกรายการใน Wallet';
    if (e.code === 'INSUFFICIENT_FUNDS') return 'ยอด Sepolia ETH ไม่พอสำหรับรายการและค่า Gas';
    if (typeof e.reason === 'string') return e.reason;
    if (typeof e.shortMessage === 'string') return e.shortMessage;
    if (typeof e.message === 'string') return e.message;
  }
  return 'ไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง';
}
