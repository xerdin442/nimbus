import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { CodedException } from '@src/common/errors';

jest.mock('@src/common/logger', () => ({
  Logger: () => ({ error: jest.fn() }),
}));

const hostWith = (response: { status: jest.Mock; json: jest.Mock }) =>
  ({
    switchToHttp: () => ({ getResponse: () => response }),
  }) as unknown as ArgumentsHost;

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  let response: { status: jest.Mock; json: jest.Mock };

  beforeEach(() => {
    response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
  });

  it('formats HttpExceptions as { error: { code, message } }', () => {
    filter.catch(
      new NotFoundException('Location not found'),
      hostWith(response),
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: 'Not Found', message: 'Location not found' },
    });
  });

  it('joins validation messages', () => {
    filter.catch(
      new BadRequestException(['name must be a string', 'city is required']),
      hostWith(response),
    );

    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'Bad Request',
        message: 'name must be a string; city is required',
      },
    });
  });

  it('includes details from a CodedException', () => {
    filter.catch(
      new CodedException(
        HttpStatus.FORBIDDEN,
        'plan_limit_reached',
        'Your plan allows 3 locations',
        { key: 'locations.max', limit: 3, current: 3 },
      ),
      hostWith(response),
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'plan_limit_reached',
        message: 'Your plan allows 3 locations',
        details: { key: 'locations.max', limit: 3, current: 3 },
      },
    });
  });

  it('hides unknown errors behind a generic 500', () => {
    filter.catch(new Error('connection refused'), hostWith(response));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });
});
