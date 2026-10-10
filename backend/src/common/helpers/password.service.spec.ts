import * as argon2 from 'argon2';
import { PasswordService } from './password.service';

// Real argon2, with verify wrapped so tests can see whether it ran.
jest.mock('argon2', () => {
  const actual = jest.requireActual<typeof import('argon2')>('argon2');
  return { ...actual, verify: jest.fn() };
});

const { verify: realVerify } =
  jest.requireActual<typeof import('argon2')>('argon2');

beforeEach(() => {
  // jest.config resetMocks clears implementations before each test; restore the pass-through.
  jest.mocked(argon2.verify).mockImplementation(realVerify);
});

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id and verifies the right password only', async () => {
    const stored = await service.hash('correct horse battery');

    expect(stored).toMatch(/^\$argon2id\$v=19\$/);
    await expect(service.verify('correct horse battery', stored)).resolves.toBe(
      true,
    );
    await expect(service.verify('wrong horse battery', stored)).resolves.toBe(
      false,
    );
  });

  it('salts every hash', async () => {
    expect(await service.hash('same')).not.toBe(await service.hash('same'));
  });

  it('still runs a verification for an unknown user, and returns false', async () => {
    await expect(service.verify('anything', undefined)).resolves.toBe(false);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    await expect(service.verify('x', 'not-a-hash')).resolves.toBe(false);
  });
});
