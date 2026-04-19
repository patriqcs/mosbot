import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, loadKey } from './encryption.js';

describe('encryption', () => {
  const key = randomBytes(32);

  it('roundtrips plaintext', () => {
    const payload = encrypt(key, 'hello world');
    expect(payload).not.toContain('hello');
    expect(decrypt(key, payload)).toBe('hello world');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encrypt(key, 'same');
    const b = encrypt(key, 'same');
    expect(a).not.toBe(b);
  });

  it('fails decryption with the wrong key', () => {
    const payload = encrypt(key, 'secret');
    expect(() => decrypt(randomBytes(32), payload)).toThrow();
  });

  it('loadKey validates 32-byte length', () => {
    const good = randomBytes(32).toString('base64');
    expect(loadKey(good)).toHaveLength(32);
    expect(() => loadKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => loadKey(undefined)).toThrow(/not set/);
  });
});
