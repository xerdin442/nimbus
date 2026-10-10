import { CodedException } from '@src/common/errors';
import { EntitlementsService } from './entitlements.service';
import type { Transaction } from '@src/common/types';

/** Minimal chainable stand-in for `tx.select().from().where().for('update')`. */
const fakeTx = () => {
  const forUpdate = jest.fn().mockResolvedValue([{ id: 'org' }]);
  const chain = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    for: forUpdate,
  };
  return { tx: chain as unknown as Transaction, forUpdate };
};

describe('EntitlementsService', () => {
  const service = new EntitlementsService();

  it('returns Basic defaults while there is no billing', async () => {
    await expect(service.get('org', 'locations.max')).resolves.toBe(3);
    await expect(service.get('org', 'reports.export')).resolves.toBe(false);
  });

  it('locks the org row before counting', async () => {
    const { tx, forUpdate } = fakeTx();
    const count = jest.fn().mockResolvedValue(0);

    await service.assertWithinLimit(tx, 'org', 'locations.max', count);

    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(forUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      count.mock.invocationCallOrder[0],
    );
  });

  it('allows creating up to the limit', async () => {
    const { tx } = fakeTx();

    await expect(
      service.assertWithinLimit(tx, 'org', 'locations.max', async () => 2),
    ).resolves.toBeUndefined();
  });

  it('throws plan_limit_reached with details at the limit', async () => {
    const { tx } = fakeTx();

    const error = await service
      .assertWithinLimit(tx, 'org', 'locations.max', async () => 3)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(403);
    expect((error as CodedException).getResponse()).toMatchObject({
      error: 'plan_limit_reached',
      details: { key: 'locations.max', limit: 3, current: 3 },
    });
  });

  it('uses Basic limits for test-mode resources', async () => {
    const { tx } = fakeTx();

    await expect(
      service.assertWithinLimit(tx, 'org', 'api_keys.test.max', async () => 2),
    ).rejects.toBeInstanceOf(CodedException);
  });
});
