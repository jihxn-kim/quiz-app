import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { RoundStatus } from './enums/round-status.enum';
import { QuestionPoolService } from './question-pool.service';
import { RoomService } from './room.service';
import { RoundService } from './round.service';

const openRound = (over: Partial<Round> = {}): Round =>
  ({ id: '10', roomId: '1', questionId: '42', sequence: 1, status: RoundStatus.OPEN, ...over }) as Round;

describe('RoundService', () => {
  let service: RoundService;
  const roundRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn((r) => r), count: jest.fn() };
  const answerRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn((a) => a), count: jest.fn() };
  const pool = { drawForRoom: jest.fn() };
  const rooms = { listParticipants: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoundService,
        { provide: getRepositoryToken(Round), useValue: roundRepo },
        { provide: getRepositoryToken(Answer), useValue: answerRepo },
        { provide: QuestionPoolService, useValue: pool },
        { provide: RoomService, useValue: rooms },
      ],
    }).compile();
    service = moduleRef.get(RoundService);
  });

  describe('start', () => {
    it('이전 라운드가 open 이면 409', async () => {
      roundRepo.findOne.mockResolvedValue(openRound());
      await expect(service.start({ id: '1' } as Room)).rejects.toBeInstanceOf(ConflictException);
      expect(pool.drawForRoom).not.toHaveBeenCalled();
    });

    it('sequence 를 이어서 부여한다', async () => {
      roundRepo.findOne.mockResolvedValue(null);
      roundRepo.count.mockResolvedValue(3);
      pool.drawForRoom.mockResolvedValue({ id: '42', text: '질문?' });

      const { round } = await service.start({ id: '1' } as Room);

      expect(round.sequence).toBe(4);
    });
  });

  describe('submit', () => {
    it('라운드가 open 이 아니면 409', async () => {
      await expect(
        service.submit(openRound({ status: RoundStatus.REVEALED }), { id: '2' } as Participant, '답'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('이미 제출했으면 409', async () => {
      answerRepo.findOne.mockResolvedValue({ id: '99' });
      await expect(
        service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('마지막 한 명이 내면 그 자리에서 공개된다', async () => {
      answerRepo.findOne.mockResolvedValue(null);
      rooms.listParticipants.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      answerRepo.count.mockResolvedValue(2); // 제출 후 2명

      const result = await service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답');

      expect(result.allSubmitted).toBe(true);
      expect(roundRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: RoundStatus.REVEALED, revealedBy: null }),
      );
    });

    it('아직 남았으면 공개하지 않는다', async () => {
      answerRepo.findOne.mockResolvedValue(null);
      rooms.listParticipants.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
      answerRepo.count.mockResolvedValue(2);

      const result = await service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답');

      expect(result.allSubmitted).toBe(false);
      expect(roundRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('reveal', () => {
    it('이미 공개됐으면 409', async () => {
      await expect(
        service.reveal(openRound({ status: RoundStatus.REVEALED }), '1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('강제 공개는 누가 했는지 남긴다', async () => {
      const round = await service.reveal(openRound(), '1');
      expect(round.status).toBe(RoundStatus.REVEALED);
      expect(round.revealedBy).toBe('1');
      expect(round.revealedAt).toBeInstanceOf(Date);
    });
  });

  describe('skip', () => {
    it('이미 공개됐으면 409', async () => {
      await expect(
        service.skip(openRound({ status: RoundStatus.REVEALED })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('skipped 로 바꾼다', async () => {
      const round = await service.skip(openRound());
      expect(round.status).toBe(RoundStatus.SKIPPED);
    });
  });
});
