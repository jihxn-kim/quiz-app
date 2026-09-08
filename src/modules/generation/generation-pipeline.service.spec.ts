import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenerationBatch } from 'src/modules/questions/entities/generation-batch.entity';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { SeedCombinationService } from 'src/modules/seeds/seed-combination.service';
import { DedupeService } from './dedupe.service';
import { GenerationPipelineService } from './generation-pipeline.service';
import { JudgeService } from './judge.service';
import { QuestionGeneratorService } from './question-generator.service';
import { SafetyService } from './safety.service';

const goodScores = {
  variance: 4, accessibility: 5, concreteness: 5, curiosity: 4, reason: 'ok',
};
const badScores = {
  variance: 1, accessibility: 2, concreteness: 2, curiosity: 1, reason: 'no',
};

describe('GenerationPipelineService', () => {
  let service: GenerationPipelineService;
  const seeds = { drawUnused: jest.fn(), markUsed: jest.fn() };
  const generator = { generate: jest.fn() };
  const dedupe = { filter: jest.fn() };
  const judge = { score: jest.fn() };
  const safety = { check: jest.fn() };
  const questionRepo = { save: jest.fn((rows) => rows), create: jest.fn((row) => row) };
  const batchRepo = { save: jest.fn((row) => row), create: jest.fn((row) => row) };

  beforeEach(async () => {
    jest.resetAllMocks();
    questionRepo.save.mockImplementation((rows) => rows);
    questionRepo.create.mockImplementation((row) => row);
    batchRepo.save.mockImplementation((row) => row);
    batchRepo.create.mockImplementation((row) => row);

    const moduleRef = await Test.createTestingModule({
      providers: [
        GenerationPipelineService,
        { provide: SeedCombinationService, useValue: seeds },
        { provide: QuestionGeneratorService, useValue: generator },
        { provide: DedupeService, useValue: dedupe },
        { provide: JudgeService, useValue: judge },
        { provide: SafetyService, useValue: safety },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
        { provide: getRepositoryToken(GenerationBatch), useValue: batchRepo },
      ],
    }).compile();
    service = moduleRef.get(GenerationPipelineService);
  });

  function arrange(kept: { text: string }[], scores: unknown[], verdicts: unknown[]) {
    seeds.drawUnused.mockResolvedValue([{ seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} }]);
    generator.generate.mockResolvedValue(kept.map((k) => ({ ...k, topicTags: ['연애'], seedHash: 'h' })));
    dedupe.filter.mockResolvedValue({
      kept: kept.map((k) => ({ ...k, topicTags: ['연애'], seedHash: 'h', embedding: [1, 0] })),
      dropped: [],
    });
    judge.score.mockResolvedValue(scores);
    safety.check.mockResolvedValue(verdicts);
  }

  it('심사와 안전을 모두 통과하면 pending 으로 저장한다', async () => {
    arrange([{ text: '좋은 질문?' }], [goodScores], [{ passed: true, reason: 'ok' }]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(summary.saved).toBe(1);
  });

  it('안전 탈락은 rejected 로 저장하고 사유를 남긴다', async () => {
    arrange([{ text: '위험 질문?' }], [goodScores], [{ passed: false, reason: '조롱' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].status).toBe(QuestionStatus.REJECTED);
    expect(saved[0].safetyReason).toBe('조롱');
  });

  it('judge 합격선 미달은 저장하지 않는다', async () => {
    arrange([{ text: '노잼 질문?' }], [badScores], [{ passed: true, reason: 'ok' }]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(questionRepo.save).not.toHaveBeenCalled();
    expect(summary.saved).toBe(0);
    expect(summary.judgePassed).toBe(0);
  });

  it('judge 가 null 이면 사람 검수로 보낸다', async () => {
    arrange([{ text: '판정불가?' }], [null], [{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(saved[0].judgeScores).toBeNull();
  });

  it('안전 판정이 null 이면 통과 처리하지 않고 검수로 보낸다', async () => {
    arrange([{ text: '판정불가?' }], [goodScores], [null]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(saved[0].safetyPassed).toBeNull();
  });

  it('사용한 시드를 markUsed 로 기록한다', async () => {
    arrange([{ text: '질문?' }], [goodScores], [{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(seeds.markUsed).toHaveBeenCalledWith([
      { seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} },
    ]);
  });

  it('질문을 저장하기 전에 시드 조합을 먼저 기록한다 (FK 순서)', async () => {
    const order: string[] = [];
    seeds.markUsed.mockImplementation(async () => { order.push('markUsed'); });
    questionRepo.save.mockImplementation(async (rows) => { order.push('save'); return rows; });
    arrange([{ text: '질문?' }], [goodScores], [{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(order).toEqual(['markUsed', 'save']);
  });

  it('생성 후보가 없는 시드는 markUsed 로 소모하지 않는다', async () => {
    seeds.drawUnused.mockResolvedValue([
      { seedHash: 'used', format: QuestionFormat.CONSTRAINT, axisValues: {} },
      { seedHash: 'unused', format: QuestionFormat.CONSTRAINT, axisValues: {} },
    ]);
    // generator 는 'used' 시드에 대해서만 후보를 만들었다 (예: 청크 하나가
    // 실패해 'unused' 몫은 통째로 비었다).
    generator.generate.mockResolvedValue([
      { text: '질문?', topicTags: ['연애'], seedHash: 'used' },
    ]);
    dedupe.filter.mockResolvedValue({
      kept: [{ text: '질문?', topicTags: ['연애'], seedHash: 'used', embedding: [1, 0] }],
      dropped: [],
    });
    judge.score.mockResolvedValue([goodScores]);
    safety.check.mockResolvedValue([{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(seeds.markUsed).toHaveBeenCalledWith([
      { seedHash: 'used', format: QuestionFormat.CONSTRAINT, axisValues: {} },
    ]);
  });

  it('생성이 모두 실패하면 어떤 시드도 소모하지 않는다', async () => {
    seeds.drawUnused.mockResolvedValue([
      { seedHash: 'h1', format: QuestionFormat.CONSTRAINT, axisValues: {} },
      { seedHash: 'h2', format: QuestionFormat.CONSTRAINT, axisValues: {} },
    ]);
    // QuestionGeneratorService 는 실패한 청크를 빈 배열로 흡수해 돌려주므로,
    // 요청이 전부 실패한 경우 generate() 는 빈 배열을 반환한다.
    generator.generate.mockResolvedValue([]);
    dedupe.filter.mockResolvedValue({ kept: [], dropped: [] });
    judge.score.mockResolvedValue([]);
    safety.check.mockResolvedValue([]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(seeds.markUsed).toHaveBeenCalledWith([]);
  });

  it('임베딩 실패로 dedupe 가 null 임베딩을 돌려줘도 저장은 정상 진행되고 pending 으로 남는다', async () => {
    seeds.drawUnused.mockResolvedValue([
      { seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} },
    ]);
    generator.generate.mockResolvedValue([
      { text: '질문?', topicTags: ['연애'], seedHash: 'h' },
    ]);
    // 임베딩 실패로 DedupeService.filter 가 null 임베딩을 붙여 그대로 통과시킨 상황.
    dedupe.filter.mockResolvedValue({
      kept: [{ text: '질문?', topicTags: ['연애'], seedHash: 'h', embedding: null }],
      dropped: [],
    });
    judge.score.mockResolvedValue([goodScores]);
    safety.check.mockResolvedValue([{ passed: true, reason: 'ok' }]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].embedding).toBeNull();
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(summary.saved).toBe(1);
  });

  it('미사용 시드가 없으면 생성을 건너뛴다', async () => {
    seeds.drawUnused.mockResolvedValue([]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(summary.generated).toBe(0);
  });

  it('중간에 실패하면 배치에 에러를 기록하고 다시 던진다', async () => {
    seeds.drawUnused.mockResolvedValue([{ seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} }]);
    generator.generate.mockRejectedValue(new Error('생성 실패'));

    await expect(service.run(QuestionFormat.CONSTRAINT, 10)).rejects.toThrow('생성 실패');

    const lastSave = batchRepo.save.mock.calls.at(-1)?.[0];
    expect(lastSave.error).toContain('생성 실패');
    expect(lastSave.finishedAt).not.toBeNull();
  });
});
