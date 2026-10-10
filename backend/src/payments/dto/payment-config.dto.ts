import { IsString, Matches } from 'class-validator';

export class ConnectPaymentConfigDto {
  @IsString()
  @Matches(/^sk_(test|live)_[A-Za-z0-9]+$/, {
    message: 'secretKey must be a Paystack secret key (sk_test_… or sk_live_…)',
  })
  secretKey: string;
}
