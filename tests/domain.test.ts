import { describe, expect, it } from 'vitest';
import {
  allocation,
  approved,
  escape,
  ethAmount,
  percentage,
  permissions,
  phase,
  safeEvidence,
  validateCampaign,
  type Campaign,
  type Milestone,
} from '../src/domain';

const campaign: Campaign = {
  campaignId: 1n,
  creator: '0x1111',
  name: 'Test',
  goal: 100n,
  deadline: 1000n,
  totalRaised: 100n,
  totalReleased: 0n,
  totalRefunded: 0n,
  releasedCount: 0n,
};
const milestone: Milestone = {
  description: 'Prototype',
  percent: 50n,
  evidence: '',
  approvalWeight: 0n,
  amountReleased: 0n,
  status: 0,
};
describe('Exact ETH amounts and campaign validation', () => {
  it('keeps wei precision', () =>
    expect(ethAmount('1.000000000000000001')).toBe(1000000000000000001n));
  it.each(['0', '-1', '1e3', 'NaN', '1.0000000000000000001', '0x10', '1,000', ''])(
    'rejects invalid ETH %s',
    (input) => expect(() => ethAmount(input)).toThrow(),
  );
  it('validates and normalizes creation arguments', () => {
    expect(
      validateCampaign('  IoT  ', '0.1', '60', [
        { description: ' Prototype ', percent: '40' },
        { description: 'Ship', percent: '60' },
      ]),
    ).toEqual({
      name: 'IoT',
      goal: 100000000000000000n,
      duration: 60n,
      descriptions: ['Prototype', 'Ship'],
      percents: [40n, 60n],
    });
  });
  it('rejects percentages that do not sum to 100', () =>
    expect(() =>
      validateCampaign('IoT', '1', '60', [{ description: 'Test', percent: '99' }]),
    ).toThrow());
  it.each(['0', '1.5', '5256001'])('rejects invalid duration %s', (duration) =>
    expect(() =>
      validateCampaign('IoT', '1', duration, [{ description: 'Test', percent: '100' }]),
    ).toThrow(),
  );
  it('rejects more than ten milestones', () =>
    expect(() =>
      validateCampaign(
        'IoT',
        '1',
        '60',
        Array.from({ length: 11 }, () => ({ description: 'Test', percent: '10' })),
      ),
    ).toThrow());
  it('rejects empty evidence descriptions in creation', () =>
    expect(() =>
      validateCampaign('IoT', '1', '60', [{ description: ' ', percent: '100' }]),
    ).toThrow());
});
describe('Contract permissions and strict voting boundary', () => {
  it('keeps funding open exactly at deadline', () => {
    expect(phase(campaign, 1000n, 2)).toBe('funding');
    expect(permissions(campaign, milestone, 0, 'backer', 0n, false, 1000n).contribute).toBe(true);
    expect(permissions(campaign, milestone, 0, campaign.creator, 0n, false, 1000n).request).toBe(
      false,
    );
  });
  it('forbids creator contribution case-insensitively', () =>
    expect(
      permissions(campaign, milestone, 0, campaign.creator.toUpperCase(), 0n, false, 900n)
        .contribute,
    ).toBe(false));
  it('requires successful funding, deadline, creator and sequential milestone', () => {
    expect(permissions(campaign, milestone, 0, campaign.creator, 0n, false, 1001n).request).toBe(
      true,
    );
    expect(permissions(campaign, milestone, 1, campaign.creator, 0n, false, 1001n).request).toBe(
      false,
    );
    expect(permissions(campaign, milestone, 0, 'backer', 1n, false, 1001n).request).toBe(false);
    expect(
      permissions(
        { ...campaign, totalRaised: 99n },
        milestone,
        0,
        campaign.creator,
        0n,
        false,
        1001n,
      ).request,
    ).toBe(false);
  });
  it('requires strictly more than 50 percent', () => {
    expect(approved(50n, 100n, 50n)).toBe(false);
    expect(approved(51n, 100n, 50n)).toBe(true);
  });
  it('prevents duplicate approval and approval by noncontributors', () => {
    const requested = { ...milestone, status: 1 };
    expect(permissions(campaign, requested, 0, 'backer', 10n, false, 1001n).approve).toBe(true);
    expect(permissions(campaign, requested, 0, 'backer', 10n, true, 1001n).approve).toBe(false);
    expect(permissions(campaign, requested, 0, 'backer', 0n, false, 1001n).approve).toBe(false);
  });
  it('allows refund only after unsuccessful deadline with remaining contribution', () => {
    const failed = { ...campaign, totalRaised: 99n };
    expect(permissions(failed, milestone, 0, 'backer', 10n, false, 1001n).refund).toBe(true);
    expect(permissions(failed, milestone, 0, 'backer', 10n, false, 1000n).refund).toBe(false);
    expect(permissions(failed, milestone, 0, 'backer', 0n, false, 1001n).refund).toBe(false);
  });
  it('allocates overfunding and final rounding remainder', () => {
    expect(
      allocation({ ...campaign, totalRaised: 101n }, { ...milestone, percent: 33n }, 0, 3),
    ).toBe(33n);
    expect(
      allocation(
        { ...campaign, totalRaised: 101n, totalReleased: 66n, releasedCount: 2n },
        milestone,
        2,
        3,
      ),
    ).toBe(35n);
  });
  it('distinguishes completion and failure', () => {
    expect(phase({ ...campaign, releasedCount: 2n }, 1001n, 2)).toBe('completed');
    expect(phase({ ...campaign, totalRaised: 99n }, 1001n, 2)).toBe('failed');
  });
});
describe('Untrusted on-chain content', () => {
  it('escapes HTML and script injection', () =>
    expect(escape('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    ));
  it.each(['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'ipfs://hash'])(
    'does not make unsafe or unsupported evidence clickable: %s',
    (value) => expect(safeEvidence(value)).toBeUndefined(),
  );
  it('permits HTTPS evidence links', () =>
    expect(safeEvidence('https://example.com/proof')).toBe('https://example.com/proof'));
  it('shows overfunding without numeric precision loss', () =>
    expect(percentage(1234567890123456789n, 1000000000000000000n)).toBe('123.45'));
});
