import { BadRequestException } from '@nestjs/common';
import { DbService } from './db.service';

describe('DbService', () => {
  let db: DbService;

  beforeEach(() => {
    // pg pools connect lazily, so no database is needed to construct the service.
    db = new DbService('postgresql://user:pass@localhost:1/none');
  });

  afterEach(async () => {
    await db.onModuleDestroy();
  });

  describe('withTenant', () => {
    it('rejects a non-UUID org id before touching the database', async () => {
      const transaction = jest.spyOn(db.client, 'transaction');
      const fn = jest.fn();

      await expect(
        db.withTenant({ orgId: "x' OR '1'='1", livemode: true }, fn),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(transaction).not.toHaveBeenCalled();
      expect(fn).not.toHaveBeenCalled();
    });

    it('sets the tenant context first, then runs the callback in the same transaction', async () => {
      const execute = jest.fn().mockResolvedValue(undefined);
      const tx = { execute };
      jest
        .spyOn(db.client, 'transaction')
        .mockImplementation(async (cb: any) => cb(tx));

      const result = await db.withTenant(
        { orgId: '9f1c1a2e-6b5d-4f0a-9a43-2f6f2c1d7e10', livemode: false },
        async (received) => {
          expect(received).toBe(tx);
          expect(execute).toHaveBeenCalledTimes(1);
          return 'done';
        },
      );

      expect(result).toBe('done');
    });
  });
});
