import { generateParticipantToken } from './token';

describe('generateParticipantToken', () => {
  it('64자 hex 를 만든다', () => {
    expect(generateParticipantToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('부를 때마다 다른 값을 만든다', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateParticipantToken()));
    expect(tokens.size).toBe(100);
  });
});
