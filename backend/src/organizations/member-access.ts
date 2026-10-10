import { HttpStatus } from '@nestjs/common';
import { CodedException } from '@src/common/errors';
import type { MembershipContext, MemberScope } from '@src/common/types';

export const isWithinLocationScope = (
  actor: MembershipContext,
  locationIds: string[],
): boolean =>
  actor.locationIds.length === 0 ||
  (locationIds.length > 0 &&
    locationIds.every((id) => actor.locationIds.includes(id)));

export const isGeneralManager = (member: MemberScope): boolean =>
  member.role === 'manager' && member.locationIds.length === 0;

/**
 * Who may manage whom:
 * - owners manage everyone, including fellow owners;
 * - general managers manage scoped managers and staff, never owners or fellow general managers;
 * - scoped managers manage staff only, and only within their locations;
 * - staff manage no one.
 */
export const assertCanManage = (
  actor: MembershipContext,
  target: MemberScope,
): void => {
  if (actor.role === 'owner') return;

  const canManageRole =
    actor.role === 'manager' &&
    (target.role === 'staff' ||
      (isGeneralManager(actor) &&
        target.role === 'manager' &&
        !isGeneralManager(target)));

  if (!canManageRole) {
    throw new CodedException(
      HttpStatus.FORBIDDEN,
      'insufficient_role',
      'You can only manage members below your role',
    );
  }

  if (!isWithinLocationScope(actor, target.locationIds)) {
    throw new CodedException(
      HttpStatus.FORBIDDEN,
      'location_forbidden',
      'Staff must be assigned only to locations you manage',
    );
  }
};
