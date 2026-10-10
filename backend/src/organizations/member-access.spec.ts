import { CodedException } from '@src/common/errors';
import type { MembershipContext, MemberScope } from '@src/common/types';
import type { Role } from '@src/db/schema/types';
import {
  assertCanManage,
  isGeneralManager,
  isWithinLocationScope,
} from './member-access';

const actor = (role: Role, locationIds: string[] = []): MembershipContext => ({
  orgId: 'org',
  role,
  locationIds,
  isVerified: true,
});

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof CodedException
      ? ((error.getResponse() as { error: string }).error ?? null)
      : 'unexpected';
  }
};

describe('isWithinLocationScope', () => {
  it('an unscoped actor covers every location set, including "all locations"', () => {
    expect(isWithinLocationScope(actor('manager'), [])).toBe(true);
    expect(isWithinLocationScope(actor('manager'), ['a', 'b'])).toBe(true);
  });

  it('a scoped actor covers only non-empty subsets of their locations', () => {
    const lekki = actor('manager', ['a', 'b']);

    expect(isWithinLocationScope(lekki, ['a'])).toBe(true);
    expect(isWithinLocationScope(lekki, ['a', 'b'])).toBe(true);
    expect(isWithinLocationScope(lekki, ['a', 'c'])).toBe(false);
    expect(isWithinLocationScope(lekki, [])).toBe(false);
  });
});

describe('isGeneralManager', () => {
  it('is an unscoped manager only', () => {
    expect(isGeneralManager({ role: 'manager', locationIds: [] })).toBe(true);
    expect(isGeneralManager({ role: 'manager', locationIds: ['a'] })).toBe(
      false,
    );
    expect(isGeneralManager({ role: 'owner', locationIds: [] })).toBe(false);
    expect(isGeneralManager({ role: 'staff', locationIds: [] })).toBe(false);
  });
});

describe('assertCanManage', () => {
  it('lets owners manage anyone, including other owners', () => {
    for (const role of ['owner', 'manager', 'staff'] as const) {
      expect(
        codeOf(() =>
          assertCanManage(actor('owner'), { role, locationIds: [] }),
        ),
      ).toBeNull();
    }
  });

  it('lets managers manage staff within their locations', () => {
    expect(
      codeOf(() =>
        assertCanManage(actor('manager', ['a']), {
          role: 'staff',
          locationIds: ['a'],
        }),
      ),
    ).toBeNull();
  });

  it('stops scoped managers acting on owners or managers', () => {
    const manager = actor('manager', ['a']);

    expect(
      codeOf(() =>
        assertCanManage(manager, { role: 'owner', locationIds: [] }),
      ),
    ).toBe('insufficient_role');
    expect(
      codeOf(() =>
        assertCanManage(manager, { role: 'manager', locationIds: ['a'] }),
      ),
    ).toBe('insufficient_role');
  });

  it('lets general managers manage scoped managers and staff anywhere', () => {
    const generalManager = actor('manager');

    const targets: MemberScope[] = [
      { role: 'manager', locationIds: ['a'] },
      { role: 'staff', locationIds: ['b'] },
      { role: 'staff', locationIds: [] },
    ];

    for (const target of targets) {
      expect(codeOf(() => assertCanManage(generalManager, target))).toBeNull();
    }
  });

  it('stops general managers acting on owners or fellow general managers', () => {
    const generalManager = actor('manager');

    expect(
      codeOf(() =>
        assertCanManage(generalManager, { role: 'owner', locationIds: [] }),
      ),
    ).toBe('insufficient_role');
    expect(
      codeOf(() =>
        assertCanManage(generalManager, { role: 'manager', locationIds: [] }),
      ),
    ).toBe('insufficient_role');
  });

  it('stops scoped managers acting outside their locations', () => {
    const manager = actor('manager', ['a']);

    expect(
      codeOf(() =>
        assertCanManage(manager, { role: 'staff', locationIds: ['b'] }),
      ),
    ).toBe('location_forbidden');
    expect(
      codeOf(() =>
        assertCanManage(manager, { role: 'staff', locationIds: [] }),
      ),
    ).toBe('location_forbidden');
  });

  it('lets staff manage no one', () => {
    expect(
      codeOf(() =>
        assertCanManage(actor('staff'), { role: 'staff', locationIds: [] }),
      ),
    ).toBe('insufficient_role');
  });
});
