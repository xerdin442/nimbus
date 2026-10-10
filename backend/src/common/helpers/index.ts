import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  providers: [EncryptionService, PasswordService],
  exports: [EncryptionService, PasswordService],
})
export class HelpersModule {}

export { EncryptionService, PasswordService };
