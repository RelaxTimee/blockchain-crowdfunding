import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import solc from 'solc';
import { Contract, JsonRpcProvider, type JsonRpcSigner } from 'ethers';
import abi from '../contracts/abi.json';
import { ADDRESS, CHAIN_ID, transact, type InjectedProvider } from '../src/chain';

let child: ChildProcess | undefined;
let provider: JsonRpcProvider;
let creator: JsonRpcSigner;
let backerA: JsonRpcSigner;
let backerB: JsonRpcSigner;
let reader: Contract;
const injectedFor = (account: string): InjectedProvider => ({
  request: async ({ method, params }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
    return provider.send(method, Array.isArray(params) ? params : []);
  },
});
async function action(signer: JsonRpcSigner, method: string, args: unknown[], value?: bigint) {
  const address = await signer.getAddress();
  return transact(injectedFor(address), address, method, args, () => {}, value);
}
async function advancePastDeadline(id: bigint) {
  const c = await reader.getFunction('getCampaign').staticCall(id);
  await provider.send('evm_setNextBlockTimestamp', [Number(c.deadline) + 1]);
  await provider.send('evm_mine', []);
}
beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No free TCP port');
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  const require = createRequire(import.meta.url);
  const platform = `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  const executable = join(
    dirname(require.resolve(`@foundry-rs/anvil-${platform}/package.json`)),
    'bin',
    process.platform === 'win32' ? 'anvil.exe' : 'anvil',
  );
  child = spawn(
    executable,
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(address.port),
      '--chain-id',
      String(CHAIN_ID),
      '--silent',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let spawnError: Error | undefined;
  child.on('error', (e) => {
    spawnError = e;
  });
  provider = new JsonRpcProvider(`http://127.0.0.1:${address.port}`, undefined, {
    batchMaxCount: 1,
    cacheTimeout: -1,
    pollingInterval: 30,
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    try {
      await provider.getNetwork();
      break;
    } catch {
      await delay(100);
    }
  }
  [creator, backerA, backerB] = (await Promise.all(
    [0, 1, 2].map((index) => provider.getSigner(index)),
  )) as [JsonRpcSigner, JsonRpcSigner, JsonRpcSigner];
  const source = readFileSync(
    new URL('../contracts/CrowdfundingMilestone.sol', import.meta.url),
    'utf8',
  );
  const compiled = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { 'CrowdfundingMilestone.sol': { content: source } },
        settings: {
          evmVersion: 'shanghai',
          outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object'] } },
        },
      }),
    ),
  ) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts: Record<
      string,
      Record<string, { abi: unknown[]; evm: { deployedBytecode: { object: string } } }>
    >;
  };
  const errors = compiled.errors?.filter((e) => e.severity === 'error');
  if (errors?.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const output = compiled.contracts['CrowdfundingMilestone.sol']?.CrowdfundingMilestone;
  if (!output) throw new Error('Compilation failed');
  expect(output.abi).toEqual(abi);
  // Install the unchanged runtime at the production address on an isolated local chain.
  // This contract has no constructor or immutable fields; its initial storage is all zero.
  await provider.send('anvil_setCode', [ADDRESS, `0x${output.evm.deployedBytecode.object}`]);
  reader = new Contract(ADDRESS, abi, provider);
}, 30000);
afterAll(() => {
  provider?.destroy();
  child?.kill();
});

describe.sequential('Production ABI and transaction adapter on local EVM', () => {
  it('creates campaign with the exact ABI and enforces validation', async () => {
    await expect(
      action(creator, 'createCampaign', ['Invalid', 100n, 1n, ['A'], [99n]]),
    ).rejects.toThrow();
    await action(creator, 'createCampaign', [
      'IoT prototype',
      100n,
      1n,
      ['Prototype', 'Launch'],
      [33n, 67n],
    ]);
    expect(await reader.getFunction('campaignCount').staticCall()).toBe(1n);
    const c = await reader.getFunction('getCampaign').staticCall(1n);
    expect(c.name).toBe('IoT prototype');
    expect(c.creator).toBe(await creator.getAddress());
  });
  it('rejects creator funding and request before deadline', async () => {
    await expect(action(creator, 'contribute', [1n], 100n)).rejects.toThrow(
      /Creator cannot contribute/,
    );
    await expect(action(creator, 'requestRelease', [1n, 0n, 'proof'])).rejects.toThrow(
      /Funding not ended/,
    );
  });
  it('contributes from two wallets and keeps funds in escrow', async () => {
    await action(backerA, 'contribute', [1n], 50n);
    await action(backerB, 'contribute', [1n], 50n);
    expect(await reader.getFunction('getContractBalance').staticCall()).toBe(100n);
    expect(
      await reader.getFunction('getContribution').staticCall(1n, await backerA.getAddress()),
    ).toBe(50n);
  });
  it('enforces order, ownership and required evidence', async () => {
    await advancePastDeadline(1n);
    await expect(action(creator, 'requestRelease', [1n, 1n, 'proof'])).rejects.toThrow(
      /Wrong milestone order/,
    );
    await expect(action(backerA, 'requestRelease', [1n, 0n, 'proof'])).rejects.toThrow(
      /Only creator/,
    );
    await expect(action(creator, 'requestRelease', [1n, 0n, ''])).rejects.toThrow(
      /Evidence required/,
    );
    await action(creator, 'requestRelease', [1n, 0n, 'https://example.com/proof']);
  });
  it('does not release at exactly 50%, rejects duplicate votes', async () => {
    await action(backerA, 'approveMilestone', [1n, 0n]);
    const m = await reader.getFunction('getMilestone').staticCall(1n, 0n);
    expect(m.approvalWeight).toBe(50n);
    expect(m.status).toBe(1n);
    expect(await reader.getFunction('getContractBalance').staticCall()).toBe(100n);
    await expect(action(backerA, 'approveMilestone', [1n, 0n])).rejects.toThrow(/Already voted/);
  });
  it('automatically releases only the milestone allocation after threshold', async () => {
    const receipt = await action(backerB, 'approveMilestone', [1n, 0n]);
    const parsed = receipt.logs.map((log) => reader.interface.parseLog(log)?.name);
    expect(parsed).toEqual(['MilestoneApproved', 'FundsReleased']);
    const m = await reader.getFunction('getMilestone').staticCall(1n, 0n);
    expect(m.status).toBe(2n);
    expect(m.amountReleased).toBe(33n);
    expect(await reader.getFunction('getContractBalance').staticCall()).toBe(67n);
    await expect(action(backerA, 'refund', [1n])).rejects.toThrow(/Goal reached/);
  });
  it('finishes sequentially, clears escrow and prevents repeated release', async () => {
    await action(creator, 'requestRelease', [1n, 1n, 'Final proof']);
    await action(backerA, 'approveMilestone', [1n, 1n]);
    await action(backerB, 'approveMilestone', [1n, 1n]);
    const c = await reader.getFunction('getCampaign').staticCall(1n);
    expect(c.totalReleased).toBe(100n);
    expect(c.releasedCount).toBe(2n);
    expect(await reader.getFunction('getContractBalance').staticCall()).toBe(0n);
    await expect(action(creator, 'requestRelease', [1n, 1n, 'Again'])).rejects.toThrow(
      /Already released/,
    );
  });
  it('refunds failed funding and prevents a second refund', async () => {
    await action(creator, 'createCampaign', ['Failed goal', 100n, 1n, ['Build'], [100n]]);
    await action(backerA, 'contribute', [2n], 10n);
    await expect(action(backerA, 'refund', [2n])).rejects.toThrow(/Funding not ended/);
    await advancePastDeadline(2n);
    await expect(action(creator, 'requestRelease', [2n, 0n, 'Proof'])).rejects.toThrow(
      /Goal not reached/,
    );
    await action(backerA, 'refund', [2n]);
    expect(
      await reader.getFunction('getContribution').staticCall(2n, await backerA.getAddress()),
    ).toBe(0n);
    const c = await reader.getFunction('getCampaign').staticCall(2n);
    expect(c.totalRefunded).toBe(10n);
    expect(c.totalRaised).toBe(10n);
    await expect(action(backerA, 'refund', [2n])).rejects.toThrow(/No contribution/);
  });
  it('blocks wrong networks and wallet account changes before sending', async () => {
    const address = await backerA.getAddress();
    const wrongNetwork: InjectedProvider = { request: async () => '0x1' };
    await expect(transact(wrongNetwork, address, 'refund', [2n], () => {})).rejects.toThrow(
      /Sepolia/,
    );
    await expect(
      transact(injectedFor(address), await backerB.getAddress(), 'refund', [2n], () => {}),
    ).rejects.toThrow(/บัญชี Wallet เปลี่ยน/);
  });
});
