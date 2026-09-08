import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStat } from 'src/modules/questions/entities/question-stat.entity';
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
  });
});
