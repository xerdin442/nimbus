import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

const contextWith = (contentType?: string) =>
  ({
    switchToHttp: () => ({
      getResponse: () => ({ getHeader: () => contentType }),
    }),
  }) as unknown as ExecutionContext;

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('wraps plain payloads in { data }', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextWith(), handlerReturning({ id: 1 })),
    );

    expect(result).toEqual({ data: { id: 1 } });
  });

  it('passes through payloads already shaped as { data, meta }', async () => {
    const paginated = { data: [1, 2], meta: { total: 2 } };

    const result = await lastValueFrom(
      interceptor.intercept(contextWith(), handlerReturning(paginated)),
    );

    expect(result).toBe(paginated);
  });

  it('does not wrap buffers or event streams', async () => {
    const buffer = Buffer.from('x');

    await expect(
      lastValueFrom(
        interceptor.intercept(contextWith(), handlerReturning(buffer)),
      ),
    ).resolves.toBe(buffer);

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextWith('text/event-stream'),
          handlerReturning('event'),
        ),
      ),
    ).resolves.toBe('event');
  });
});
