import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { ReviewService, AUTO_APPROVE_THRESHOLD, AUTO_APPROVE_MIN_APPROVED } from './review.service';

const question = (overrides: Partial<Question> = {}) =>
  ({
    id: '1',
    judgeScores: { variance: 5, accessibility: 5, concreteness: 4, curiosity: 5, reason: '' },
    safetyPassed: true,
    ...overrides,
  }) as Question;

describe('ReviewService', () => {
  let service: ReviewService;
  const repo = { find: jest.fn(), update: jest.fn(), count: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewService, { provide: getRepositoryToken(Question), useValue: repo }],
    }).compile();
    service = moduleRef.get(ReviewService);
  });

  describe('shouldAutoApprove', () => {
    it('승인 누적이 기준 미만이면 항상 false', () => {
      expect(
        service.shouldAutoApprove(question(), AUTO_APPROVE_MIN_APPROVED - 1, 0.1),
      ).toBe(false);
    });

    it('조건을 모두 만족하면 true', () => {
      expect(
        service.shouldAutoApprove(question(), AUTO_APPROVE_MIN_APPROVED, 0.1),
      ).toBe(true);
    });

    it('유사도가 0.7 이상이면 false', () => {
      expect(
        service.shouldAutoApprove(question(), AUTO_APPROVE_MIN_APPROVED, AUTO_APPROVE_THRESHOLD),
      ).toBe(false);
    });

    it('judge 평균이 4.5 미만이면 false', () => {
      const low = question({
        judgeScores: { variance: 4, accessibility: 4, concreteness: 4, curiosity: 4, reason: '' },
      });
      expect(service.shouldAutoApprove(low, AUTO_APPROVE_MIN_APPROVED, 0.1)).toBe(false);
    });

    it('안전 판정이 null 이면 false', () => {
      expect(
        service.shouldAutoApprove(question({ safetyPassed: null }), AUTO_APPROVE_MIN_APPROVED, 0.1),
      ).toBe(false);
    });

    it('judgeScores 가 null 이면 false', () => {
      expect(
        service.shouldAutoApprove(question({ judgeScores: null }), AUTO_APPROVE_MIN_APPROVED, 0.1),
      ).toBe(false);
    });
  });

  describe('listPending', () => {
    it('safetyPassed 가 null 인 항목이 먼저 오도록, createdAt ASC 를 보조 정렬로 정렬한다', async () => {
      repo.find.mockResolvedValue([]);

      await service.listPending();

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: {
            safetyPassed: { direction: 'ASC', nulls: 'FIRST' },
            createdAt: 'ASC',
          },
        }),
      );
    });
  });

  describe('approve', () => {
    it('pending 상태인 질문만 승인 대상으로 삼아 상태를 바꾸고 검수자를 기록한다', async () => {
      repo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.approve('7', 'jihun');

      expect(repo.update).toHaveBeenCalledWith(
        { id: '7', status: QuestionStatus.PENDING },
        expect.objectContaining({
          status: QuestionStatus.APPROVED,
          reviewedBy: 'jihun',
        }),
      );
    });

    it('대상 행이 없으면(이미 처리됐거나 존재하지 않으면) 에러를 던진다', async () => {
      repo.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await expect(service.approve('999', 'jihun')).rejects.toThrow('999');
    });
  });

  describe('reject', () => {
    it('pending 상태인 질문만 반려 대상으로 삼아 상태를 rejected 로 바꾸고 사유를 남긴다', async () => {
      repo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.reject('7', 'jihun', '톤이 조롱에 가까움');

      expect(repo.update).toHaveBeenCalledWith(
        { id: '7', status: QuestionStatus.PENDING },
        expect.objectContaining({
          status: QuestionStatus.REJECTED,
          safetyReason: '톤이 조롱에 가까움',
        }),
      );
    });

    it('대상 행이 없으면 에러를 던진다', async () => {
      repo.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await expect(service.reject('999', 'jihun', '사유')).rejects.toThrow('999');
    });
  });

  describe('publish', () => {
    it('approved 상태인 질문만 배포 대상으로 삼아 live 로 바꾼다', async () => {
      repo.update.mockResolvedValue({ affected: 2, raw: [], generatedMaps: [] });

      await service.publish(['3', '7']);

      expect(repo.update).toHaveBeenCalledWith(
        { id: In(['3', '7']), status: QuestionStatus.APPROVED },
        { status: QuestionStatus.LIVE },
      );
    });

    it('요청한 id 중 일부가 approved 상태가 아니면 에러를 던지고 나머지도 live 로 올리지 않는다', async () => {
      repo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await expect(service.publish(['3', '7', '999'])).rejects.toThrow('2건');
    });

    it('빈 배열이면 update 를 호출하지 않는다', async () => {
      await service.publish([]);

      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
