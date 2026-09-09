import { Vote } from './vote.entity';

describe('Vote 엔티티', () => {
  it('필드를 담는다', () => {
    const vote = new Vote();
    vote.roundId = '10';
    vote.voterParticipantId = '2';
    vote.answerId = '77';

    expect(vote.roundId).toBe('10');
    expect(vote.voterParticipantId).toBe('2');
    expect(vote.answerId).toBe('77');
  });
});
