import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WinstonModule } from 'nest-winston';
import { configureApp } from './app.setup';
import { Logger } from './common/logger';
import { Secrets } from './common/secrets';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: WinstonModule.createLogger({ instance: Logger('Nest') }),
  });

  configureApp(app);

  await app.listen(Secrets.PORT, '0.0.0.0');
}
void bootstrap();
