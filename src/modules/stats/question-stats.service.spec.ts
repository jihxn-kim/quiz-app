import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStat } from 'src/modules/questions/entities/question-stat.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { QuestionStatsService, MIN_SERVED } from './question-stats.service';

describe('QuestionStatsService', () => {
  let service: QuestionStatsService;
  const embedding = { embed: jest.fn() };
  const statRepo = { findOne: jest.fn(), save: jest.fn(), find: jest.fn() };
  const questionRepo = { update: jest.fn(), find: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionStatsService,
        { provide: EmbeddingClient, useValue: embedding },
        { provide: getRepositoryToken(QuestionStat), useValue: statRepo },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
      ],
    }).compile();
    service = moduleRef.get(QuestionStatsService);
  });

  describe('recordAnswers', () => {
    it('답변이 다양하면 분산도가 크다', async () => {
      embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordAnswers('1', ['답변 A', '전혀 다른 답변 B']);

      const saved = statRepo.save.mock.calls[0][0];
      expect(saved.answerVariance).toBeGreaterThan(0.5);
      expect(saved.completed).toBe(1);
    });

    it('평균 답변 길이를 기록한다', async () => {
      embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordAnswers('1', ['1234', '123456']);

      expect(statRepo.save.mock.calls[0][0].avgAnswerLen).toBe(5);
    });

    it('답변이 1개면 분산도는 0 이다', async () => {
      embedding.embed.mockResolvedValue([[1, 0]]);
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordAnswers('1', ['혼자']);

      expect(statRepo.save.mock.calls[0][0].answerVariance).toBe(0);
    });

    it('답변이 없으면 아무것도 하지 않는다', async () => {
      await service.recordAnswers('1', []);

      expect(embedding.embed).not.toHaveBeenCalled();
      expect(statRepo.save).not.toHaveBeenCalled();
    });

    it('처음 기록할 때는 해당 방의 값을 그대로 저장한다 (null 초기값 처리)', async () => {
      embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);
      statRepo.findOne.mockResolvedValue({
        questionId: '1',
        served: 1,
        completed: 0,
        skipped: 0,
        answerVariance: null,
        avgAnswerLen: null,
      });

      await service.recordAnswers('1', ['1234', '123456']);

      const saved = statRepo.save.mock.calls[0][0];
      expect(saved.answerVariance).toBe(1);
      expect(saved.avgAnswerLen).toBe(5);
    });

    it('같은 질문에 두 번 기록하면 분산도는 두 방의 누적 평균이지, 두 번째 방 값으로 덮어써지지 않는다', async () => {
      // findOne 이 매번 같은 참조를 반환하도록 해서 실제 영속화된 행이 다음 호출에
      // 그대로 전달되는 상황을 흉내낸다. 서비스가 이 객체를 직접 mutate 하므로
      // 1차 호출의 결과가 2차 호출의 "이전 상태"가 된다.
      const stat: Partial<QuestionStat> = {
        questionId: '1',
        served: 2,
        completed: 0,
        skipped: 0,
        answerVariance: null,
        avgAnswerLen: null,
      };
      statRepo.findOne.mockResolvedValue(stat);

      // 방 1: 답변이 완전히 같아 분산도 0
      embedding.embed.mockResolvedValueOnce([[1, 0], [1, 0]]);
      await service.recordAnswers('1', ['답변', '답변']);
      expect(statRepo.save.mock.calls[0][0].answerVariance).toBe(0);

      // 방 2: 답변이 완전히 달라 분산도 1
      embedding.embed.mockResolvedValueOnce([[1, 0], [0, 1]]);
      await service.recordAnswers('1', ['답변 A', '전혀 다른 답변 B']);

      const secondSaved = statRepo.save.mock.calls[1][0];
      // 덮어쓰기라면 두 번째 방의 값인 1이 저장된다. 누적 평균이라면
      // (0 + 1) / 2 = 0.5 가 저장되어야 한다.
      expect(secondSaved.answerVariance).toBeCloseTo(0.5);
      expect(secondSaved.answerVariance).not.toBe(1);
    });

    it('avgAnswerLen 도 방마다 누적 평균으로 갱신된다 (덮어쓰지 않는다)', async () => {
      const stat: Partial<QuestionStat> = {
        questionId: '1',
        served: 2,
        completed: 0,
        skipped: 0,
        answerVariance: null,
        avgAnswerLen: null,
      };
      statRepo.findOne.mockResolvedValue(stat);

      embedding.embed.mockResolvedValueOnce([[1, 0], [0, 1]]);
      await service.recordAnswers('1', ['12', '12']); // 평균 길이 2
      expect(statRepo.save.mock.calls[0][0].avgAnswerLen).toBe(2);

      embedding.embed.mockResolvedValueOnce([[1, 0], [0, 1]]);
      await service.recordAnswers('1', ['123456', '123456']); // 평균 길이 6

      const secondSaved = statRepo.save.mock.calls[1][0];
      // 덮어쓰기라면 6이 저장된다. 누적 평균이라면 (2 + 6) / 2 = 4 가 저장되어야 한다.
      expect(secondSaved.avgAnswerLen).toBe(4);
      expect(secondSaved.avgAnswerLen).not.toBe(6);
    });
  });

  describe('promoteGolden', () => {
    it('서빙 30회 미만은 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: MIN_SERVED - 1, skipped: 0, completed: 20, answerVariance: 0.9 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
      expect(questionRepo.update).not.toHaveBeenCalled();
    });

    it('스킵률이 높으면 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 20, completed: 80, answerVariance: 0.9 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
    });

    it('분산도 상위 20% 이고 조건을 만족하면 승격한다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 90, answerVariance: 0.9 },
        { questionId: '2', served: 100, skipped: 1, completed: 90, answerVariance: 0.5 },
        { questionId: '3', served: 100, skipped: 1, completed: 90, answerVariance: 0.4 },
        { questionId: '4', served: 100, skipped: 1, completed: 90, answerVariance: 0.3 },
        { questionId: '5', served: 100, skipped: 1, completed: 90, answerVariance: 0.2 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(1);
      expect(questionRepo.update).toHaveBeenCalledWith(['1'], { golden: true });
    });
  });

  describe('retireUnderperformers', () => {
    it('스킵률 0.3 초과면 은퇴시킨다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 40, completed: 50, answerVariance: 0.8 },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(1);
    });

    it('서빙 30회 미만은 은퇴시키지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 5, skipped: 5, completed: 0, answerVariance: 0.1 },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(0);
    });

    it('스킵률은 모두 안전 범위일 때 분산도 하위 10%만 은퇴한다', async () => {
      // 모든 행의 스킵률(1%)이 RETIRE_SKIP_RATE(0.3)보다 훨씬 낮으므로
      // OR 의 스킵률 쪽은 절대 발동하지 않는다. 분산도 비교(<=)만으로
      // 어떤 행이 은퇴하는지가 결정되는 상황을 만든다.
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 90, answerVariance: 0.9 },
        { questionId: '2', served: 100, skipped: 1, completed: 90, answerVariance: 0.7 },
        { questionId: '3', served: 100, skipped: 1, completed: 90, answerVariance: 0.5 },
        { questionId: '4', served: 100, skipped: 1, completed: 90, answerVariance: 0.3 },
        { questionId: '5', served: 100, skipped: 1, completed: 90, answerVariance: 0.1 },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(1);
      expect(questionRepo.update).toHaveBeenCalledWith(['5'], {
        status: QuestionStatus.RETIRED,
      });
    });
  });
});
