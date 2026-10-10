import { Module } from '@nestjs/common';
import { OrgVerificationService } from './org-verification.service';

/**
 * Separate from OrganizationsModule so payments/ and notifications/ can use it without a
 * circular import (OrganizationsModule itself imports notifications/ for invite emails).
 */
@Module({
  providers: [OrgVerificationService],
  exports: [OrgVerificationService],
})
export class OrgVerificationModule {}
