import { HttpStatus } from '@nestjs/common';
import { CodedException } from '@src/common/errors';
import type { MembershipContext } from '@src/common/types';

export const assertLocationAccess = (
  membership: MembershipContext,
  locationId: string,
): void => {
  const canAccessLocation =
    membership.locationIds.length === 0 ||
    membership.locationIds.includes(locationId);

  if (!canAccessLocation) {
    throw new CodedException(
      HttpStatus.FORBIDDEN,
      'location_forbidden',
      'You do not have access to this location',
    );
  }
};

export const canAccessAllLocations = (
  membership: MembershipContext,
  action: 'create' | 'archive' | 'unarchive',
  entity: 'location' | 'movie' = 'location',
): void => {
  if (membership.locationIds.length) {
    throw new CodedException(
      HttpStatus.FORBIDDEN,
      'location_forbidden',
      `Only members with access to all locations can ${action} a ${entity}`,
    );
  }
};
