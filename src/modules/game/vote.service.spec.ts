import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Round } from './entities/round.entity';
import { Vote } from './entities/vote.entity';
import { RoundStatus } from './enums/round-status.enum';
import { RoomService } from './room.service';
import { VoteService } from './vote.service';

const revealedRound = (over: Partial<Round> = {}): Round =>
  ({ id: '10', roomId: '1', questionId: '42', sequence: 1, status: RoundStatus.REVEALED, votingClosedAt: null, ...over }) as Round;

describe('VoteService', () => {
  let service: VoteService;
  const voteRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn() };
  const manager = { findOne: jest.fn(), save: jest.fn(), count: jest.fn() };
  const dataSource = { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) };
  const rooms = { listParticipants: jest.fn() };
  const roundRepo = { findOne: jest.fn(), update: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.transaction.mockImplementation((cb: (m: typeof manager) => unknown) => cb(manager));
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoteService,
        { provide: getRepositoryToken(Vote), useValue: voteRepo },
        { provide: getRepositoryToken(Round), useValue: roundRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: RoomService, useValue: rooms },
      ],
    }).compile();
    service = moduleRef.get(VoteService);
  });

  describe('cast', () => {
    it('다른 방 참가자면 403', async () => {
      await expect(
        service.cast(revealedRound(), { id: '9', roomId: '999' } as Participant, '77'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('공개되지 않은 라운드면 409', async () => {
      manager.findOne.mockResolvedValueOnce(revealedRound({ status: RoundStatus.OPEN }));
      await expect(
        service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '77'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('이미 닫힌 투표면 409', async () => {
      manager.findOne.mockResolvedValueOnce(revealedRound({ votingClosedAt: new Date() }));
      await expect(
        service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '77'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('그 라운드의 답변이 아니면 404', async () => {
      manager.findOne
        .mockResolvedValueOnce(revealedRound())   // 잠근 라운드
        .mockResolvedValueOnce(null);             // answerId 조회 실패
      await expect(
        service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '999'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('이미 투표했으면 409', async () => {
      manager.findOne
        .mockResolvedValueOnce(revealedRound())
        .mockResolvedValueOnce({ id: '77', roundId: '10' } as Answer)
        .mockResolvedValueOnce({ id: '5' } as Vote);
      await expect(
        service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '77'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('마지막 한 명이 투표하면 그 자리에서 닫힌다', async () => {
      manager.findOne
        .mockResolvedValueOnce(revealedRound())
        .mockResolvedValueOnce({ id: '77', roundId: '10' } as Answer)
        .mockResolvedValueOnce(null);
      rooms.listParticipants.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      manager.count.mockResolvedValue(2);

      const result = await service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '77');

      expect(result.allVoted).toBe(true);
      expect(manager.save).toHaveBeenCalledWith(
        Round,
        expect.objectContaining({ votingClosedAt: expect.any(Date) }),
      );
    });

    it('아직 남았으면 닫지 않는다', async () => {
      manager.findOne
        .mockResolvedValueOnce(revealedRound())
        .mockResolvedValueOnce({ id: '77', roundId: '10' } as Answer)
        .mockResolvedValueOnce(null);
      rooms.listParticipants.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
      manager.count.mockResolvedValue(2);

      const result = await service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '77');

      expect(result.allVoted).toBe(false);
      expect(manager.save).not.toHaveBeenCalledWith(Round, expect.anything());
    });

    it('유니크 위반은 409 로 바꾼다', async () => {
      manager.findOne
        .mockResolvedValueOnce(revealedRound())
        .mockResolvedValueOnce({ id: '77', roundId: '10' } as Answer)
        .mockResolvedValueOnce(null);
      manager.save.mockRejectedValueOnce({ driverError: { code: '23505' } });

      await expect(
        service.cast(revealedRound(), { id: '2', roomId: '1' } as Participant, '77'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('close', () => {
    it('이미 닫혔으면 409', async () => {
      roundRepo.update.mockResolvedValue({ affected: 0 });
      await expect(service.close(revealedRound())).rejects.toBeInstanceOf(ConflictException);
    });

    it('닫으면 시각을 남기고 갱신된 라운드를 돌려준다', async () => {
      roundRepo.update.mockResolvedValue({ affected: 1 });
      roundRepo.findOne.mockResolvedValue(revealedRound({ votingClosedAt: new Date() }));

      const closed = await service.close(revealedRound());

      expect(closed.votingClosedAt).not.toBeNull();
    });
  });

  describe('countByAnswer', () => {
    it('답변별 득표 수를 센다', async () => {
      voteRepo.find.mockResolvedValue([
        { answerId: '77' }, { answerId: '77' }, { answerId: '88' },
      ]);

      const counts = await service.countByAnswer('10');

      expect(counts.get('77')).toBe(2);
      expect(counts.get('88')).toBe(1);
    });

    it('표가 없으면 빈 맵', async () => {
      voteRepo.find.mockResolvedValue([]);
      expect((await service.countByAnswer('10')).size).toBe(0);
    });
  });
});
