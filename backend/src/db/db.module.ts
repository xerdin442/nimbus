import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { Secrets } from '@src/common/secrets';

@Global()
@Module({
  providers: [
    {
      provide: DbService,
      useFactory: () => new DbService(Secrets.DATABASE_URL),
    },
  ],
  exports: [DbService],
})
export class DbModule {}
