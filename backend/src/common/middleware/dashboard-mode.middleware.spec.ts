import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import type { DashboardRequest } from '@src/common/types';
import { DashboardModeMiddleware } from './dashboard-mode.middleware';

const requestWith = (mode?: string) =>
  ({
    headers: mode === undefined ? {} : { 'x-nimbus-mode': mode },
  }) as unknown as DashboardRequest;

describe('DashboardModeMiddleware', () => {
  const middleware = new DashboardModeMiddleware();
  const next = jest.fn();

  it('defaults to live when the header is missing', () => {
    const req = requestWith();
    middleware.use(req, {} as Response, next);

    expect(req.livemode).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it.each([
    ['test', false],
    ['live', true],
  ])('maps %s → livemode %s', (mode, livemode) => {
    const req = requestWith(mode);
    middleware.use(req, {} as Response, next);

    expect(req.livemode).toBe(livemode);
  });

  it('rejects any other value', () => {
    expect(() =>
      middleware.use(requestWith('TEST'), {} as Response, next),
    ).toThrow(BadRequestException);
    expect(next).not.toHaveBeenCalled();
  });
});
