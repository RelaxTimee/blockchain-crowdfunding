import { describe, expect, it, vi } from 'vitest';
import { JsonRpcProvider, type Log } from 'ethers';
import {
  ADDRESS,
  CHAIN_ID,
  CrowdfundingClient,
  connectWallet,
  contractInterface,
  type InjectedProvider,
} from '../src/chain';
import { errorText } from '../src/domain';

describe('Wallet connection', () => {
  const address = '0x1111111111111111111111111111111111111111';
  it('connects an authorized Sepolia account without a network prompt', async () => {
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === 'eth_chainId' ? `0x${CHAIN_ID.toString(16)}` : [address],
    );
    expect(await connectWallet({ request })).toBe(address);
    expect(request.mock.calls.some(([arg]) => arg.method === 'wallet_switchEthereumChain')).toBe(
      false,
    );
  });
  it('adds an unknown Sepolia network, switches and verifies the resulting chain', async () => {
    let current = '0x1';
    let added = false;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return current;
      if (method === 'wallet_addEthereumChain') {
        added = true;
        return null;
      }
      if (method === 'wallet_switchEthereumChain') {
        if (!added) throw { code: 4902 };
        current = '0xaa36a7';
        return null;
      }
      return [address];
    });
    expect(await connectWallet({ request })).toBe(address);
    expect(added).toBe(true);
    expect(
      request.mock.calls.filter(([arg]) => arg.method === 'wallet_switchEthereumChain'),
    ).toHaveLength(2);
  });
  it('propagates wallet rejection without adding a network', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') throw { code: 4001 };
      return [address];
    });
    await expect(connectWallet({ request })).rejects.toMatchObject({ code: 4001 });
    expect(request.mock.calls.some(([arg]) => arg.method === 'wallet_addEthereumChain')).toBe(
      false,
    );
    expect(errorText({ code: 'ACTION_REJECTED' })).toContain('ยกเลิก');
  });
  it('rejects wallets that silently remain on the wrong network', async () => {
    const provider: InjectedProvider = {
      request: async ({ method }) => (method === 'eth_chainId' ? '0x1' : [address]),
    };
    await expect(connectWallet(provider)).rejects.toThrow(/Sepolia/);
  });
});
describe('Bounded event history', () => {
  function reader(getLogs: ReturnType<typeof vi.fn>) {
    const client = new CrowdfundingClient();
    client.creationBlock = 100;
    client.provider = { getLogs } as unknown as JsonRpcProvider;
    return client;
  }
  it('filters by campaign and keeps vote and release from the same transaction', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const vote = contractInterface.encodeEventLog(
      contractInterface.getEvent('MilestoneApproved')!,
      [1n, 0n, ADDRESS, 51n],
    );
    const release = contractInterface.encodeEventLog(contractInterface.getEvent('FundsReleased')!, [
      1n,
      0n,
      ADDRESS,
      30n,
    ]);
    const getLogs = vi.fn(
      async (_filter: { address: string; fromBlock: number; toBlock: number }) =>
        [
          { ...vote, transactionHash: hash, blockNumber: 110, index: 0 },
          { ...release, transactionHash: hash, blockNumber: 110, index: 1 },
        ] as unknown as Log[],
    );
    const result = await reader(getLogs).activity(1n, 120);
    expect(result.events.map((e) => e.name)).toEqual(['FundsReleased', 'MilestoneApproved']);
    expect(result.events[0]?.amount).toBe(30n);
    expect(result.next).toBe(99);
    expect(getLogs.mock.calls[0]?.[0]).toMatchObject({
      address: ADDRESS,
      fromBlock: 100,
      toBlock: 120,
    });
  });
  it('splits oversized RPC ranges without skipping blocks', async () => {
    const ranges: [number, number][] = [];
    const getLogs = vi.fn(
      async ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) => {
        if (toBlock - fromBlock > 20) throw new Error('block range exceeds maximum');
        ranges.push([fromBlock, toBlock]);
        return [];
      },
    );
    await reader(getLogs).activity(1n, 180);
    expect(ranges).toEqual([
      [100, 120],
      [121, 140],
      [141, 160],
      [161, 180],
    ]);
  });
  it('fails immediately on transport errors instead of flooding the RPC', async () => {
    const getLogs = vi.fn(async () => {
      throw new Error('Network disconnected');
    });
    await expect(reader(getLogs).activity(1n, 2000)).rejects.toThrow('Network disconnected');
    expect(getLogs).toHaveBeenCalledTimes(1);
  });
  it('scans at most 10000 blocks and returns a cursor for older history', async () => {
    const getLogs = vi.fn(async (_filter: { fromBlock: number; toBlock: number }) => []);
    const result = await reader(getLogs).activity(1n, 20000);
    expect(getLogs).toHaveBeenCalledTimes(5);
    expect(result.next).toBe(10000);
    expect(getLogs.mock.calls[0]?.[0]).toMatchObject({ fromBlock: 10001, toBlock: 12000 });
  });
});
