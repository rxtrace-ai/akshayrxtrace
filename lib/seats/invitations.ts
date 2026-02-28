import { createHash, randomBytes } from 'crypto';

export function createSeatInviteToken(): string {
  return randomBytes(24).toString('hex');
}

export function hashSeatInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
