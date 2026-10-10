import { SetMetadata } from '@nestjs/common';
import type { Role } from '@src/db/schema/types';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
