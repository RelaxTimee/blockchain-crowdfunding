import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Contract, FetchRequest, JsonRpcProvider, keccak256 } from 'ethers';

const address = '0x7AdC7237D1E4aC47C8E315e10711428c431bAF6B';
const creationHash = '0x24e3ca3eb98da5c29613c61ae76c040bce072eeb9126de6884629622de76363d';
const abiBytes = await readFile(new URL('../contracts/abi.json', import.meta.url));
const sourceBytes = await readFile(
  new URL('../contracts/CrowdfundingMilestone.sol', import.meta.url),
);
const request = new FetchRequest(
  process.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
);
request.timeout = 12000;
const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
try {
  if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error('Wrong network');
  const block = await provider.getBlock('latest');
  if (!block) throw new Error('Latest block unavailable');
  const code = await provider.getCode(address, block.number);
  if (code === '0x') throw new Error('Contract has no runtime code');
  const creation = await provider.getTransactionReceipt(creationHash);
  if (creation?.contractAddress?.toLowerCase() !== address.toLowerCase())
    throw new Error('Creation receipt does not match address');
  const contract = new Contract(address, JSON.parse(abiBytes.toString()), provider);
  const options = { blockTag: block.number };
  const [count, balance, threshold] = await Promise.all([
    contract.campaignCount(options),
    contract.getContractBalance(options),
    contract.approvalPercent(options),
  ]);
  const report = {
    checkedAt: new Date().toISOString(),
    address,
    chainId: '11155111',
    sourceUrl: `https://sepolia.etherscan.io/address/${address}#code`,
    creationTransaction: creationHash,
    creationBlock: creation.blockNumber,
    snapshotBlock: block.number,
    blockTimestamp: block.timestamp,
    campaignCount: String(count),
    contractBalanceWei: String(balance),
    approvalPercent: String(threshold),
    runtimeBytecodeKeccak256: keccak256(code),
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    abiSha256: createHash('sha256').update(abiBytes).digest('hex'),
    scope:
      'Read-only live Sepolia verification; no transactions submitted. Source and ABI downloaded from Etherscan. Runtime hash recorded, not independently recompiled to match deployed metadata.',
  };
  if (process.argv.includes('--write'))
    await writeFile(
      new URL('../docs/sepolia-check.json', import.meta.url),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  provider.destroy();
}
