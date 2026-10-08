import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { Logger } from './common/logger';
import { Secrets } from './common/secrets';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: WinstonModule.createLogger({ instance: Logger('Nest') }),
  });

  app.enableCors({
    origin: Secrets.DASHBOARD_URL,
    credentials: true,
  });
  app.use(helmet());
  app.setGlobalPrefix('/api');
  app.enableShutdownHooks();

  // Public API controllers declare a version.
  // Dashboard and webhook controllers declare none and stay unversioned.
  app.enableVersioning({ type: VersioningType.URI });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      stopAtFirstError: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  app.getHttpAdapter().get('/', (_req: Request, res: Response) => {
    res.send('Nimbus API is running!');
  });

  await app.listen(Secrets.PORT, '0.0.0.0');
}
void bootstrap();
