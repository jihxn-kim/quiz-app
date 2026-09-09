import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStat } from 'src/modules/questions/entities/question-stat.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { QuestionStatsService, MIN_SERVED, MIN_LIVE_POOL } from './question-stats.service';

describe('QuestionStatsService', () => {
  let service: QuestionStatsService;
  const statRepo = { findOne: jest.fn(), save: jest.fn(), find: jest.fn(), create: jest.fn() };
  const questionRepo = { update: jest.fn(), find: jest.fn(), count: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionStatsService,
        { provide: getRepositoryToken(QuestionStat), useValue: statRepo },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
      ],
    }).compile();
    service = moduleRef.get(QuestionStatsService);
  });

  describe('임베딩 미사용', () => {
    it('recordCompleted / promoteGolden / retireUnderperformers 어느 경로도 임베딩 API 를 호출하지 않는다', async () => {
      // 실제 EmbeddingClient 프로토타입을 스파이한다 — 이 서비스가 DI 로
      // 그 클래스를 주입받지 않더라도, 어딘가에서 직접 임포트해 호출하면
      // 이 스파이가 그것도 잡아낸다. 이번 변경의 핵심 회귀선이다.
      const embedSpy = jest.spyOn(EmbeddingClient.prototype, 'embed');

      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });
      await service.recordCompleted('1', ['답변 A', '전혀 다른 답변 B']);

      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 90 },
      ]);
      questionRepo.update.mockResolvedValue({ affected: 1 });
      await service.promoteGolden();

      questionRepo.count.mockResolvedValue(1000);
      await service.retireUnderperformers();

      expect(embedSpy).not.toHaveBeenCalled();
      embedSpy.mockRestore();
    });
  });

  describe('recordCompleted', () => {
    it('평균 답변 길이를 기록한다', async () => {
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordCompleted('1', ['1234', '123456']);

      const saved = statRepo.save.mock.calls[0][0];
      expect(saved.avgAnswerLen).toBe(5);
      expect(saved.completed).toBe(1);
    });

    it('답변이 없으면 아무것도 하지 않는다', async () => {
      await service.recordCompleted('1', []);

      expect(statRepo.findOne).not.toHaveBeenCalled();
      expect(statRepo.save).not.toHaveBeenCalled();
    });

    it('처음 기록할 때는 해당 방의 값을 그대로 저장한다 (null 초기값 처리)', async () => {
      statRepo.findOne.mockResolvedValue({
        questionId: '1',
        served: 1,
        completed: 0,
        skipped: 0,
        answerVariance: null,
        avgAnswerLen: null,
      });

      await service.recordCompleted('1', ['1234', '123456']);

      const saved = statRepo.save.mock.calls[0][0];
      expect(saved.avgAnswerLen).toBe(5);
      expect(saved.completed).toBe(1);
    });

    it('avgAnswerLen 과 completed 는 방마다 누적된다 (덮어쓰지 않는다)', async () => {
      const stat: Partial<QuestionStat> = {
        questionId: '1',
        served: 2,
        completed: 0,
        skipped: 0,
        answerVariance: null,
        avgAnswerLen: null,
      };
      statRepo.findOne.mockResolvedValue(stat);

      await service.recordCompleted('1', ['12', '12']); // 평균 길이 2
      expect(statRepo.save.mock.calls[0][0].avgAnswerLen).toBe(2);
      expect(statRepo.save.mock.calls[0][0].completed).toBe(1);

      await service.recordCompleted('1', ['123456', '123456']); // 평균 길이 6

      const secondSaved = statRepo.save.mock.calls[1][0];
      // 덮어쓰기라면 6이 저장된다. 누적 평균이라면 (2 + 6) / 2 = 4 가 저장되어야 한다.
      expect(secondSaved.avgAnswerLen).toBe(4);
      expect(secondSaved.avgAnswerLen).not.toBe(6);
      expect(secondSaved.completed).toBe(2);
    });
  });

  describe('promoteGolden', () => {
    it('서빙 30회 미만은 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: MIN_SERVED - 1, skipped: 0, completed: 20 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
      expect(questionRepo.update).not.toHaveBeenCalled();
    });

    it('스킵률이 높으면 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 20, completed: 80 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
    });

    it('완주율이 낮으면(70% 이하) 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 70 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
      expect(questionRepo.update).not.toHaveBeenCalled();
    });

    it('완주율 상위 20% 이고 조건을 만족하면 승격한다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 99 },
        { questionId: '2', served: 100, skipped: 1, completed: 95 },
        { questionId: '3', served: 100, skipped: 1, completed: 90 },
        { questionId: '4', served: 100, skipped: 1, completed: 85 },
        { questionId: '5', served: 100, skipped: 1, completed: 80 },
      ]);
      questionRepo.update.mockResolvedValue({ affected: 1 });

      await expect(service.promoteGolden()).resolves.toBe(1);
      expect(questionRepo.update).toHaveBeenCalledWith(
        { id: In(['1']), status: In([QuestionStatus.LIVE, QuestionStatus.APPROVED]) },
        { golden: true },
      );
    });

    it('rejected/retired 로 넘어간 질문은 승격 대상에서 걸러지고, 실제로 반영된 건수만 반환한다', async () => {
      // rejected 질문 하나가 여전히 완주율 조건을 만족해 후보에 포함되더라도,
      // DB 쪽 status 필터가 걸러 실제로는 반영되지 않는 상황을 흉내낸다.
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 95 },
      ]);
      questionRepo.update.mockResolvedValue({ affected: 0 });

      const promoted = await service.promoteGolden();

      expect(questionRepo.update).toHaveBeenCalledWith(
        { id: In(['1']), status: In([QuestionStatus.LIVE, QuestionStatus.APPROVED]) },
        { golden: true },
      );
      // ids.length(1) 이 아니라 실제로 반영된 건수(0)를 반환해야 한다.
      expect(promoted).toBe(0);
    });
  });

  describe('recordServed / recordSkipped', () => {
    it('통계 행이 없으면 만들어서 1로 시작한다', async () => {
      statRepo.findOne.mockResolvedValue(null);
      statRepo.create.mockImplementation((r: unknown) => r);

      await service.recordServed('42');

      expect(statRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ questionId: '42', served: 1 }),
      );
    });

    it('기존 행이 있으면 증가시킨다', async () => {
      statRepo.findOne.mockResolvedValue({ questionId: '42', served: 5, skipped: 2, completed: 3 });

      await service.recordServed('42');

      expect(statRepo.save).toHaveBeenCalledWith(expect.objectContaining({ served: 6 }));
    });

    it('스킵은 skipped 만 올린다', async () => {
      statRepo.findOne.mockResolvedValue({ questionId: '42', served: 5, skipped: 2, completed: 3 });

      await service.recordSkipped('42');

      const saved = statRepo.save.mock.calls[0][0];
      expect(saved.skipped).toBe(3);
      expect(saved.served).toBe(5);
    });
  });

  describe('retireUnderperformers', () => {
    it('스킵률 0.3 초과면 은퇴시킨다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 40, completed: 50 },
      ]);
      questionRepo.count.mockResolvedValue(1000); // live 풀이 충분히 크다

      await expect(service.retireUnderperformers()).resolves.toBe(1);
    });

    it('서빙 30회 미만은 은퇴시키지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 5, skipped: 5, completed: 0 },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(0);
      // 후보가 없으므로 live 풀 크기를 조회할 필요조차 없다.
      expect(questionRepo.count).not.toHaveBeenCalled();
    });

    it('분산도 신호가 전부 없는(모든 answerVariance 가 null 인) 상태에서도 스킵률이 낮은 질문은 은퇴시키지 않는다', async () => {
      // 임베딩 호출을 없앤 뒤 answerVariance 는 영원히 null 로 남는다.
      // ?? 0 으로 읽던 예전 코드라면 모든 행의 variance 가 0 이 되어
      // "하위 10%" 상대 컷오프에 걸린 질문 하나가 아무 근거 없이 은퇴됐다.
      // 지금은 스킵률만 기준이므로, 스킵률이 낮으면(1%) 전부 살아남아야 한다.
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 90, answerVariance: null },
        { questionId: '2', served: 100, skipped: 1, completed: 90, answerVariance: null },
        { questionId: '3', served: 100, skipped: 1, completed: 90, answerVariance: null },
        { questionId: '4', served: 100, skipped: 1, completed: 90, answerVariance: null },
        { questionId: '5', served: 100, skipped: 1, completed: 90, answerVariance: null },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(0);
      expect(questionRepo.update).not.toHaveBeenCalled();
      // 은퇴 후보가 아예 없으므로 live 풀 크기를 조회할 필요조차 없다.
      expect(questionRepo.count).not.toHaveBeenCalled();
    });

    it('golden 도 함께 false 로 내린다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '5', served: 100, skipped: 40, completed: 50 },
      ]);
      questionRepo.count.mockResolvedValue(1000);

      await expect(service.retireUnderperformers()).resolves.toBe(1);
      // golden 도 함께 false 로 내려가야 한다 — 그렇지 않으면 은퇴한 질문이
      // loadGoldenPool 에서 계속 few-shot 예시로 뽑힌다.
      expect(questionRepo.update).toHaveBeenCalledWith(['5'], {
        status: QuestionStatus.RETIRED,
        golden: false,
      });
    });

    it('은퇴시키면 live 풀이 최소 보유량 아래로 떨어질 때는 아무것도 은퇴시키지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 40, completed: 50 },
      ]);
      // live 50건 중 1건을 은퇴시키면 49건 — MIN_LIVE_POOL(50) 미만이 된다.
      questionRepo.count.mockResolvedValue(MIN_LIVE_POOL);

      await expect(service.retireUnderperformers()).resolves.toBe(0);
      expect(questionRepo.update).not.toHaveBeenCalled();
    });

    it('은퇴 후에도 정확히 최소 보유량이 남으면(경계값) 은퇴시킨다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 40, completed: 50 },
      ]);
      // live 51건 중 1건을 은퇴시키면 정확히 50건 — MIN_LIVE_POOL 과 같으므로
      // "아래로 떨어진다"에 해당하지 않는다.
      questionRepo.count.mockResolvedValue(MIN_LIVE_POOL + 1);

      await expect(service.retireUnderperformers()).resolves.toBe(1);
      expect(questionRepo.update).toHaveBeenCalled();
    });
  });
});
