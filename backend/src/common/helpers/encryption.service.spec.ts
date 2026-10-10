import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  const service = new EncryptionService();

  it('encrypts and decrypts a string', () => {
    const plaintext = 'sk_live_secret_value';
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext', () => {
    const a = service.encrypt('test');
    const b = service.encrypt('test');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', () => {
    const [iv, tag, data] = service.encrypt('secret').split(':');
    const flipped = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);

    expect(() => service.decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  describe('hash', () => {
    it('produces a 64-character hex sha256 digest', () => {
      expect(service.hash('sk_test_abc')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for the same input', () => {
      expect(service.hash('same-value')).toBe(service.hash('same-value'));
    });

    it('produces different digests for different input', () => {
      expect(service.hash('value-a')).not.toBe(service.hash('value-b'));
    });
  });
});
