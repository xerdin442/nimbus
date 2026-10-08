import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { Secrets } from '@src/common/secrets';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async () => {
        const client = createClient({ url: Secrets.REDIS_URL });
        await client.connect();

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  async onApplicationShutdown() {
    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }
}
