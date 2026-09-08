import { randomBytes } from 'node:crypto';

/** 참가자 신분 토큰. 계정이 없으므로 이 값이 곧 신분이다. */
export function generateParticipantToken(): string {
  return randomBytes(32).toString('hex');
}
