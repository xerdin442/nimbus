import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { Secrets } from './common/secrets';

const corsFor = (req: Request): CorsOptions =>
  /^\/api\/v\d+\//.test(req.url)
    ? { origin: true, credentials: false }
    : { origin: Secrets.DASHBOARD_URL, credentials: true };

export function configureApp(app: INestApplication): INestApplication {
  app.enableCors(
    (
      req: Request,
      callback: (error: Error | null, options: CorsOptions) => void,
    ) => callback(null, corsFor(req)),
  );
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

  return app;
}
