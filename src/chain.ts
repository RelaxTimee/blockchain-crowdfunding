import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  FetchRequest,
  Interface,
  getAddress,
  toBeHex,
  zeroPadValue,
  type Eip1193Provider,
  type Log,
  type TransactionReceipt,
} from 'ethers';
import abi from '../contracts/abi.json';
import type { Campaign, Milestone } from './domain';

export const ADDRESS = '0x7AdC7237D1E4aC47C8E315e10711428c431bAF6B';
export const CHAIN_ID = 11155111n;
export const EXPLORER = 'https://sepolia.etherscan.io';
export const CREATION_TX = '0x24e3ca3eb98da5c29613c61ae76c040bce072eeb9126de6884629622de76363d';
export const contractInterface = new Interface(abi);
const rpcUrls = [
  ...new Set(
    [
      import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined,
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
    ].filter((u): u is string => !!u),
  ),
];

export interface InjectedProvider extends Eip1193Provider {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  providers?: InjectedProvider[];
  isMetaMask?: boolean;
}
declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}
export interface WalletOption {
  id: string;
  name: string;
  provider: InjectedProvider;
}
export interface Snapshot {
  campaigns: Campaign[];
  total: bigint;
  balance: bigint;
  threshold: bigint;
  timestamp: bigint;
  block: number;
}
export interface Details {
  milestones: Milestone[];
  contribution: bigint;
  votes: boolean[];
}
export interface Activity {
  name: string;
  hash: string;
  block: number;
  index: number;
  amount?: bigint;
  actor?: string;
  milestone?: bigint;
}

export class CrowdfundingClient {
  provider?: JsonRpcProvider;
  private contract?: Contract;
  creationBlock = 0;

  async open(): Promise<void> {
    const failures: string[] = [];
    for (const url of rpcUrls) {
      const request = new FetchRequest(url);
      request.timeout = 12000;
      const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
      try {
        const network = await provider.getNetwork();
        if (network.chainId !== CHAIN_ID) throw new Error('RPC ต้องเป็น Sepolia');
        if ((await provider.getCode(ADDRESS)) === '0x') throw new Error('ไม่พบ Contract บน RPC นี้');
        const receipt = await provider.getTransactionReceipt(CREATION_TX);
        if (!receipt || receipt.contractAddress?.toLowerCase() !== ADDRESS.toLowerCase())
          throw new Error('ตรวจสอบ block ที่ deploy ไม่สำเร็จ');
        this.creationBlock = receipt.blockNumber;
        this.provider = provider;
        this.contract = new Contract(ADDRESS, abi, provider);
        return;
      } catch (error) {
        provider.destroy();
        failures.push(
          `${new URL(url).hostname}: ${error instanceof Error ? error.message : 'RPC error'}`,
        );
      }
    }
    throw new Error(`เชื่อมต่อ Sepolia ไม่สำเร็จ กรุณากดลองใหม่ (${failures.join('; ')})`);
  }
  private ready(): Contract {
    if (!this.contract || !this.provider) throw new Error('ยังไม่เชื่อมต่อ Sepolia');
    return this.contract;
  }
  async snapshot(page: number, pageSize = 6): Promise<Snapshot> {
    const c = this.ready();
    const block = await this.provider!.getBlock('latest');
    if (!block) throw new Error('ไม่พบ block ล่าสุด');
    const opts = { blockTag: block.number };
    const [total, balance, threshold] = await Promise.all([
      c.getFunction('campaignCount').staticCall(opts) as Promise<bigint>,
      c.getFunction('getContractBalance').staticCall(opts) as Promise<bigint>,
      c.getFunction('approvalPercent').staticCall(opts) as Promise<bigint>,
    ]);
    const top = total - BigInt(page * pageSize);
    const ids = Array.from({ length: pageSize }, (_, i) => top - BigInt(i)).filter((id) => id > 0n);
    const campaigns = await Promise.all(ids.map((id) => this.campaign(id, block.number)));
    return {
      campaigns,
      total,
      balance,
      threshold,
      timestamp: BigInt(block.timestamp),
      block: block.number,
    };
  }
  async campaign(id: bigint, block: number): Promise<Campaign> {
    const r = await this.ready().getFunction('getCampaign').staticCall(id, { blockTag: block });
    return {
      campaignId: r.campaignId,
      creator: r.creator,
      name: r.name,
      goal: r.goal,
      deadline: r.deadline,
      totalRaised: r.totalRaised,
      totalReleased: r.totalReleased,
      totalRefunded: r.totalRefunded,
      releasedCount: r.releasedCount,
    } as Campaign;
  }
  async details(id: bigint, account: string | undefined, block: number): Promise<Details> {
    const c = this.ready();
    const opts = { blockTag: block };
    const raw = (await c.getFunction('getMilestones').staticCall(id, opts)) as readonly (Omit<
      Milestone,
      'status'
    > & { status: bigint })[];
    const milestones = raw.map((r) => ({
      description: r.description,
      percent: r.percent,
      evidence: r.evidence,
      approvalWeight: r.approvalWeight,
      amountReleased: r.amountReleased,
      status: Number(r.status),
    }));
    const contribution = account
      ? ((await c.getFunction('getContribution').staticCall(id, account, opts)) as bigint)
      : 0n;
    const votes = await Promise.all(
      milestones.map((_, index) =>
        account
          ? (c.getFunction('hasVoted').staticCall(id, index, account, opts) as Promise<boolean>)
          : Promise.resolve(false),
      ),
    );
    return { milestones, contribution, votes };
  }
  async activity(id: bigint, end: number): Promise<{ events: Activity[]; next: number }> {
    const from = Math.max(this.creationBlock, end - 9999);
    const logs: Log[] = [];
    // Small ranges and adaptive splitting support RPC services with strict log limits.
    const fetchRange = async (start: number, stop: number): Promise<void> => {
      try {
        logs.push(
          ...(await this.provider!.getLogs({
            address: ADDRESS,
            topics: [null, zeroPadValue(toBeHex(id), 32)],
            fromBlock: start,
            toBlock: stop,
          })),
        );
      } catch (error) {
        const failure = error as {
          message?: string;
          shortMessage?: string;
          info?: { error?: { message?: string } };
        };
        // Inspect messages only: stack frames such as "fetchRange" are not RPC limit errors.
        const message = [failure?.message, failure?.shortMessage, failure?.info?.error?.message]
          .filter(Boolean)
          .join(' ');
        if (stop - start < 20 || !/limit|range|too many|size|maximum|more than/i.test(message))
          throw error;
        const mid = Math.floor((start + stop) / 2);
        await fetchRange(start, mid);
        await fetchRange(mid + 1, stop);
      }
    };
    for (let start = from; start <= end; start += 2000)
      await fetchRange(start, Math.min(start + 1999, end));
    const events = logs
      .map((log) => {
        const parsed = contractInterface.parseLog(log);
        if (!parsed) throw new Error('ไม่สามารถถอดรหัส Event');
        const amount = parsed.args.amount as bigint | undefined;
        return {
          name: parsed.name,
          hash: log.transactionHash,
          block: log.blockNumber,
          index: log.index,
          amount,
          actor: (parsed.args.backer ?? parsed.args.creator ?? parsed.args.to) as
            string | undefined,
          milestone: parsed.args.milestoneIndex as bigint | undefined,
        };
      })
      .sort((a, b) => b.block - a.block || b.index - a.index);
    return { events, next: from - 1 };
  }
}

export async function connectWallet(injected: InjectedProvider): Promise<string> {
  await injected.request({ method: 'eth_requestAccounts' });
  if (BigInt((await injected.request({ method: 'eth_chainId' })) as string) !== CHAIN_ID) {
    try {
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await injected.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: '0xaa36a7',
            chainName: 'Sepolia',
            nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [rpcUrls[0]],
            blockExplorerUrls: [EXPLORER],
          },
        ],
      });
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      });
    }
  }
  if (BigInt((await injected.request({ method: 'eth_chainId' })) as string) !== CHAIN_ID)
    throw new Error('Wallet ยังไม่ได้เปลี่ยนเป็นเครือข่าย Sepolia');
  const accounts = (await injected.request({ method: 'eth_accounts' })) as string[];
  if (!accounts[0]) throw new Error('Wallet ไม่ได้ให้สิทธิ์เข้าถึงบัญชี');
  return getAddress(accounts[0]);
}
export async function transact(
  injected: InjectedProvider,
  expectedAccount: string,
  method: string,
  args: readonly unknown[],
  onHash: (hash: string) => void,
  value?: bigint,
): Promise<TransactionReceipt> {
  if (BigInt((await injected.request({ method: 'eth_chainId' })) as string) !== CHAIN_ID)
    throw new Error('กรุณาเปลี่ยน Wallet เป็น Sepolia แล้วเชื่อมต่ออีกครั้ง');
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner();
  if ((await signer.getAddress()).toLowerCase() !== expectedAccount.toLowerCase())
    throw new Error('บัญชี Wallet เปลี่ยนไป กรุณาลองใหม่');
  const contract = new Contract(ADDRESS, abi, signer);
  const fn = contract.getFunction(method);
  const parameters = value === undefined ? [...args] : [...args, { value }];
  await fn.staticCall(...parameters);
  const tx = await fn(...parameters);
  onHash(tx.hash);
  let receipt: TransactionReceipt | null;
  try {
    receipt = await tx.wait(1);
  } catch (error) {
    const e = error as { code?: string; cancelled?: boolean; receipt?: TransactionReceipt };
    if (e.code !== 'TRANSACTION_REPLACED' || e.cancelled || !e.receipt) throw error;
    receipt = e.receipt;
    onHash(receipt.hash);
  }
  if (!receipt || receipt.status !== 1) throw new Error('ธุรกรรมไม่สำเร็จบนเครือข่าย');
  return receipt;
}
