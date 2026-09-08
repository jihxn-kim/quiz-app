import { RoomStatus } from './room-status.enum';
import { RoundStatus } from './round-status.enum';

describe('게임 열거형', () => {
  it('방 상태는 waiting/playing 두 가지다', () => {
    expect(Object.values(RoomStatus)).toEqual(['waiting', 'playing']);
  });

  it('라운드 상태는 open/revealed/skipped 세 가지다', () => {
    expect(Object.values(RoundStatus)).toEqual(['open', 'revealed', 'skipped']);
  });
});
