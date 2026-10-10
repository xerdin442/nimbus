import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

const OPTIONS = { type: argon2.argon2id } as const;

@Injectable()
export class PasswordService {
  /**
   * Verified against when the email doesn't exist, so a login for an unknown email takes as long
   * as one with a wrong password (prevents user-enumeration timing signal).
   */
  private readonly dummyHash = this.hash(randomBytes(32).toString('hex'));

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(password: string, stored: string | undefined): Promise<boolean> {
    const hash = stored ?? (await this.dummyHash);

    try {
      return (await argon2.verify(hash, password)) && stored !== undefined;
    } catch {
      return false;
    }
  }
}
