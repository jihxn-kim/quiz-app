import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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

  describe('approve', () => {
    it('상태를 approved 로 바꾸고 검수자를 기록한다', async () => {
      await service.approve('7', 'jihun');

      expect(repo.update).toHaveBeenCalledWith('7', expect.objectContaining({
        status: QuestionStatus.APPROVED,
        reviewedBy: 'jihun',
      }));
    });
  });

  describe('reject', () => {
    it('상태를 rejected 로 바꾸고 사유를 남긴다', async () => {
      await service.reject('7', 'jihun', '톤이 조롱에 가까움');

      expect(repo.update).toHaveBeenCalledWith('7', expect.objectContaining({
        status: QuestionStatus.REJECTED,
        safetyReason: '톤이 조롱에 가까움',
      }));
    });
  });
});
