import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ParticipantGuard } from './participant.guard';

function contextWith(headers: Record<string, string>) {
  const request: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    __request: request,
  } as unknown as ExecutionContext & { __request: Record<string, unknown> };
}

describe('ParticipantGuard', () => {
  const repo = { findOne: jest.fn() };
  const guard = new ParticipantGuard(repo as never);

  beforeEach(() => jest.resetAllMocks());

  it('토큰이 없으면 401', async () => {
    await expect(guard.canActivate(contextWith({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('토큰이 어떤 참가자와도 안 맞으면 401', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      guard.canActivate(contextWith({ 'x-participant-token': 'deadbeef' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('맞으면 통과시키고 request 에 참가자를 붙인다', async () => {
    const participant = { id: '7', roomId: '1', nickname: '지훈' };
    repo.findOne.mockResolvedValue(participant);

    const ctx = contextWith({ 'x-participant-token': 'abc' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.__request.participant).toBe(participant);
  });
});
