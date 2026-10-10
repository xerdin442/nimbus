import { Module } from '@nestjs/common';
import { OrgVerificationModule } from '@src/organizations/org-verification.module';
import { PaymentConfigController } from './payment-config.controller';
import { PaymentConfigService } from './payment-config.service';
import { PaystackProvider } from './providers/paystack.provider';

@Module({
  imports: [OrgVerificationModule],
  controllers: [PaymentConfigController],
  providers: [PaymentConfigService, PaystackProvider],
})
export class PaymentsModule {}
