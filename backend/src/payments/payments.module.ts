import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrgVerificationModule } from '@src/organizations/org-verification.module';
import { DashboardPaymentConfigController } from './controllers/dashboard/payment-config.controller';
import { PaystackWebhookController } from './controllers/webhooks/paystack-webhook.controller';
import { PaymentConfigService } from './payment-config.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentWebhooksService } from './payment-webhooks.service';
import { PaymentsService } from './payments.service';
import { PaymentsProcessor } from './payments.processor';
import { PaystackProvider } from './providers/paystack.provider';
import { PAYMENTS_QUEUE } from '@src/common/types/constants';

@Module({
  imports: [
    OrgVerificationModule,
    BullModule.registerQueue({ name: PAYMENTS_QUEUE }),
  ],
  controllers: [DashboardPaymentConfigController, PaystackWebhookController],
  providers: [
    PaymentConfigService,
    PaystackProvider,
    PaymentGatewayService,
    PaymentsService,
    PaymentWebhooksService,
    PaymentsProcessor,
  ],
  exports: [PaymentsService, PaymentGatewayService],
})
export class PaymentsModule {}
