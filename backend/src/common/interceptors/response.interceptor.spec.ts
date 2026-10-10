import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { Readable } from 'stream';
import { ResponseInterceptor } from './response.interceptor';

const context = {} as ExecutionContext;

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  const run = (value: unknown) =>
    lastValueFrom(interceptor.intercept(context, handlerReturning(value)));

  it('wraps plain payloads in { data }', async () => {
    await expect(run({ id: 1 })).resolves.toEqual({ data: { id: 1 } });
  });

  it('wraps null and primitives too', async () => {
    await expect(run(null)).resolves.toEqual({ data: null });
    await expect(run('ok')).resolves.toEqual({ data: 'ok' });
  });

  it('passes through payloads already shaped as { data, meta }', async () => {
    const paginated = { data: [1, 2], meta: { total: 2 } };

    await expect(run(paginated)).resolves.toBe(paginated);
  });

  it('does not wrap buffers or streams', async () => {
    const buffer = Buffer.from('x');
    const stream = Readable.from(['x']);

    await expect(run(buffer)).resolves.toBe(buffer);
    await expect(run(stream)).resolves.toBe(stream);
  });
});
