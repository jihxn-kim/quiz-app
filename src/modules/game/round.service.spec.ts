import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { RoundStatus } from './enums/round-status.enum';
import { QuestionStatsService } from 'src/modules/stats/question-stats.service';
import { QuestionPoolService } from './question-pool.service';
import { RoomService } from './room.service';
import { RoundService } from './round.service';

const openRound = (over: Partial<Round> = {}): Round =>
  ({ id: '10', roomId: '1', questionId: '42', sequence: 1, status: RoundStatus.OPEN, ...over }) as Round;

describe('RoundService', () => {
  let service: RoundService;
  const roundRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((r) => r),
    count: jest.fn(),
    update: jest.fn(),
  };
  const answerRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn((a) => a), count: jest.fn() };
  const pool = { drawForRoom: jest.fn() };
  const rooms = { listParticipants: jest.fn() };
  // submit() 은 라운드 행을 잠그고 트랜잭션 안에서 동작한다. manager 는 라운드/답변 양쪽에
  // 쓰이므로 첫 번째 인자(엔티티 클래스)로 호출을 구분해 검증한다.
  const manager = { findOne: jest.fn(), save: jest.fn((_entity, data) => data), count: jest.fn() };
  const dataSource = { transaction: jest.fn((run: (m: typeof manager) => unknown) => run(manager)) };
  const stats = { recordServed: jest.fn(), recordSkipped: jest.fn(), recordAnswers: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoundService,
        { provide: getRepositoryToken(Round), useValue: roundRepo },
        { provide: getRepositoryToken(Answer), useValue: answerRepo },
        { provide: QuestionPoolService, useValue: pool },
        { provide: RoomService, useValue: rooms },
        { provide: DataSource, useValue: dataSource },
        { provide: QuestionStatsService, useValue: stats },
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

    it('라운드를 시작하면 served 를 올린다', async () => {
      roundRepo.findOne.mockResolvedValue(null);
      roundRepo.count.mockResolvedValue(0);
      pool.drawForRoom.mockResolvedValue({ id: '42', text: '질문?' });

      await service.start({ id: '1' } as Room);

      expect(stats.recordServed).toHaveBeenCalledWith('42');
    });
  });

  describe('findById', () => {
    it('찾으면 반환한다', async () => {
      roundRepo.findOne.mockResolvedValue(openRound());
      const round = await service.findById('10');
      expect(round.id).toBe('10');
    });

    it('없으면 404', async () => {
      roundRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('999')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findLatest', () => {
    it('sequence 가 가장 큰 라운드를 반환한다', async () => {
      roundRepo.findOne.mockResolvedValue(openRound({ sequence: 3 }));
      const round = await service.findLatest('1');
      expect(round?.sequence).toBe(3);
      expect(roundRepo.findOne).toHaveBeenCalledWith({
        where: { roomId: '1' },
        order: { sequence: 'DESC' },
      });
    });

    it('라운드가 하나도 없으면 null', async () => {
      roundRepo.findOne.mockResolvedValue(null);
      await expect(service.findLatest('1')).resolves.toBeNull();
    });
  });

  describe('submit', () => {
    it('다른 방 참가자가 제출하면 403', async () => {
      await expect(
        service.submit(openRound(), { id: '2', roomId: '999' } as Participant, '답'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('라운드가 open 이 아니면 409 (잠근 행을 기준으로 판단한다)', async () => {
      manager.findOne.mockResolvedValueOnce(openRound({ status: RoundStatus.REVEALED }));

      await expect(
        service.submit(openRound({ status: RoundStatus.OPEN }), { id: '2', roomId: '1' } as Participant, '답'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('이미 제출했으면 409', async () => {
      manager.findOne
        .mockResolvedValueOnce(openRound()) // 잠긴 라운드
        .mockResolvedValueOnce({ id: '99' }); // 기존 답변

      await expect(
        service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('insert 가 유니크 위반으로 실패하면 409 로 변환한다', async () => {
      manager.findOne
        .mockResolvedValueOnce(openRound()) // 잠긴 라운드
        .mockResolvedValueOnce(null); // 확인 시점엔 없었음(경쟁)
      manager.save.mockImplementationOnce(() => {
        const error = new Error('duplicate key value violates unique constraint');
        (error as { driverError?: { code?: string } }).driverError = { code: '23505' };
        throw error;
      });

      await expect(
        service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('마지막 한 명이 내면 그 자리에서 공개된다', async () => {
      manager.findOne
        .mockResolvedValueOnce(openRound()) // 잠긴 라운드
        .mockResolvedValueOnce(null); // 기존 답변 없음
      rooms.listParticipants.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      manager.count.mockResolvedValue(2); // 제출 후 2명
      // 커밋 후 통계를 위해 라운드를 다시 읽는다 (REVEALED 상태로).
      roundRepo.findOne.mockResolvedValue(openRound({ status: RoundStatus.REVEALED }));

      const result = await service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답');

      expect(result.allSubmitted).toBe(true);
      expect(manager.save).toHaveBeenCalledWith(
        Round,
        expect.objectContaining({ status: RoundStatus.REVEALED, revealedBy: null }),
      );
    });

    it('아직 남았으면 공개하지 않는다', async () => {
      manager.findOne
        .mockResolvedValueOnce(openRound()) // 잠긴 라운드
        .mockResolvedValueOnce(null); // 기존 답변 없음
      rooms.listParticipants.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
      manager.count.mockResolvedValue(2);

      const result = await service.submit(openRound(), { id: '2', roomId: '1' } as Participant, '답');

      expect(result.allSubmitted).toBe(false);
      expect(manager.save).not.toHaveBeenCalledWith(Round, expect.anything());
    });
  });

  describe('reveal', () => {
    it('이미 공개됐으면 409', async () => {
      roundRepo.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.reveal(openRound({ status: RoundStatus.REVEALED }), '1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('강제 공개는 누가 했는지 남긴다', async () => {
      roundRepo.update.mockResolvedValue({ affected: 1 });
      roundRepo.findOne.mockResolvedValue(
        openRound({ status: RoundStatus.REVEALED, revealedBy: '1', revealedAt: new Date() }),
      );

      const round = await service.reveal(openRound(), '1');

      expect(roundRepo.update).toHaveBeenCalledWith(
        { id: '10', status: RoundStatus.OPEN },
        expect.objectContaining({ status: RoundStatus.REVEALED, revealedBy: '1' }),
      );
      expect(round.status).toBe(RoundStatus.REVEALED);
      expect(round.revealedBy).toBe('1');
      expect(round.revealedAt).toBeInstanceOf(Date);
    });

    it('답변이 2개 미만이면 recordAnswers 를 부르지 않는다', async () => {
      answerRepo.find.mockResolvedValue([{ participantId: '1', text: '혼자' }]);
      await service.reveal(openRound(), '1');
      expect(stats.recordAnswers).not.toHaveBeenCalled();
    });

    it('답변이 2개 이상이면 recordAnswers 를 부른다', async () => {
      answerRepo.find.mockResolvedValue([
        { participantId: '1', text: '답1' },
        { participantId: '2', text: '답2' },
      ]);
      await service.reveal(openRound(), '1');
      expect(stats.recordAnswers).toHaveBeenCalledWith('42', ['답1', '답2']);
    });
  });

  describe('skip', () => {
    it('이미 공개됐으면 409', async () => {
      roundRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.skip(openRound({ status: RoundStatus.REVEALED }))).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('skipped 로 바꾼다', async () => {
      roundRepo.update.mockResolvedValue({ affected: 1 });
      roundRepo.findOne.mockResolvedValue(openRound({ status: RoundStatus.SKIPPED }));

      const round = await service.skip(openRound());

      expect(roundRepo.update).toHaveBeenCalledWith(
        { id: '10', status: RoundStatus.OPEN },
        { status: RoundStatus.SKIPPED },
      );
      expect(round.status).toBe(RoundStatus.SKIPPED);
    });

    it('스킵하면 skipped 를 올린다', async () => {
      await service.skip(openRound());
      expect(stats.recordSkipped).toHaveBeenCalledWith('42');
    });

    it('통계가 실패해도 게임은 진행된다', async () => {
      stats.recordSkipped.mockRejectedValue(new Error('DB 다운'));
      await expect(service.skip(openRound())).resolves.toBeDefined();
    });
  });

  describe('listAnswers', () => {
    it('열린 라운드면 거부한다', async () => {
      await expect(service.listAnswers(openRound())).rejects.toBeInstanceOf(ConflictException);
      expect(answerRepo.find).not.toHaveBeenCalled();
    });

    it('공개된 라운드의 답변을 시간순으로 반환한다', async () => {
      const rows = [{ id: '1', text: '답1' }];
      answerRepo.find.mockResolvedValue(rows);

      const answers = await service.listAnswers(openRound({ status: RoundStatus.REVEALED }));

      expect(answers).toBe(rows);
      expect(answerRepo.find).toHaveBeenCalledWith({
        where: { roundId: '10' },
        order: { createdAt: 'ASC' },
      });
    });

    it('스킵된 라운드의 답변도 반환한다', async () => {
      answerRepo.find.mockResolvedValue([]);
      await expect(service.listAnswers(openRound({ status: RoundStatus.SKIPPED }))).resolves.toEqual([]);
    });
  });

  describe('findMyAnswer', () => {
    it('제출했으면 답변을 반환한다', async () => {
      const answer = { id: '5', text: '내 답' };
      answerRepo.findOne.mockResolvedValue(answer);

      await expect(service.findMyAnswer('10', '2')).resolves.toBe(answer);
    });

    it('미제출이면 null', async () => {
      answerRepo.findOne.mockResolvedValue(null);
      await expect(service.findMyAnswer('10', '2')).resolves.toBeNull();
    });
  });

  describe('submittedParticipantIds', () => {
    it('제출한 참가자 id 집합을 반환한다', async () => {
      answerRepo.find.mockResolvedValue([{ participantId: '1' }, { participantId: '2' }]);
      const ids = await service.submittedParticipantIds('10');
      expect(ids).toEqual(new Set(['1', '2']));
    });

    it('아무도 제출하지 않았으면 빈 집합을 반환한다', async () => {
      answerRepo.find.mockResolvedValue([]);
      const ids = await service.submittedParticipantIds('10');
      expect(ids.size).toBe(0);
    });
  });
});
