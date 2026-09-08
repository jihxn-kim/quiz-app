jest.mock('src/common/utils/cosine');

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { cosineSimilarity } from 'src/common/utils/cosine';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { GeneratedQuestion } from './schemas/generated-question.schema';
import { DedupeService } from './dedupe.service';

const q = (text: string): GeneratedQuestion => ({ text, topicTags: ['연애'], seedHash: 'h' });

describe('DedupeService', () => {
  let service: DedupeService;
  const embedding = { embed: jest.fn() };
  const repo = { find: jest.fn() };
  const actualCosineSimilarity = jest.requireActual<typeof import('src/common/utils/cosine')>('src/common/utils/cosine').cosineSimilarity;

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.mocked(cosineSimilarity).mockImplementation(actualCosineSimilarity);
    repo.find.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        DedupeService,
        { provide: EmbeddingClient, useValue: embedding },
        { provide: getRepositoryToken(Question), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(DedupeService);
  });

  it('서로 다른 질문은 모두 남긴다', async () => {
    embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);

    const result = await service.filter([q('A?'), q('B?')]);

    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('같은 배치 안에서 유사도 0.85 초과면 뒤엣것을 버린다', async () => {
    embedding.embed.mockResolvedValue([[1, 0], [0.999, 0.01]]);

    const result = await service.filter([q('A?'), q('A 비슷?')]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].text).toBe('A?');
    expect(result.dropped[0].text).toBe('A 비슷?');
    expect(result.dropped[0].similarity).toBeGreaterThan(0.85);
  });

  it('기존 풀과 유사하면 버린다', async () => {
    repo.find.mockResolvedValue([{ text: '기존?', embedding: [1, 0] }]);
    embedding.embed.mockResolvedValue([[0.999, 0.01]]);

    const result = await service.filter([q('새거?')]);

    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].against).toBe('기존?');
  });

  it('경계값 0.85 는 통과시킨다 (초과일 때만 탈락)', async () => {
    // 임계값 판정만 떼어 검증하기 위해 유사도 계산을 목으로 고정한다.
    // 벡터 기하는 Task 5 의 관심사다.
    jest.mocked(cosineSimilarity).mockReturnValue(0.85);
    repo.find.mockResolvedValue([{ text: '기존?', embedding: [1, 0] }]);
    embedding.embed.mockResolvedValue([[1, 0]]);

    const result = await service.filter([q('경계?')]);

    expect(result.kept).toHaveLength(1);
  });

  it('경계값을 아주 조금이라도 넘으면 탈락시킨다', async () => {
    jest.mocked(cosineSimilarity).mockReturnValue(0.8500000000000001);
    repo.find.mockResolvedValue([{ text: '기존?', embedding: [1, 0] }]);
    embedding.embed.mockResolvedValue([[1, 0]]);

    const result = await service.filter([q('간신히 초과?')]);

    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });

  it('임베딩이 없는 기존 질문은 비교에서 제외한다', async () => {
    repo.find.mockResolvedValue([{ text: '임베딩없음?', embedding: null }]);
    embedding.embed.mockResolvedValue([[1, 0]]);

    const result = await service.filter([q('새거?')]);

    expect(result.kept).toHaveLength(1);
  });

  it('빈 입력이면 임베딩을 호출하지 않는다', async () => {
    const result = await service.filter([]);

    expect(result).toEqual({ kept: [], dropped: [] });
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('남긴 질문에 임베딩을 붙여 반환한다', async () => {
    embedding.embed.mockResolvedValue([[1, 0]]);

    const result = await service.filter([q('A?')]);

    expect(result.kept[0].embedding).toEqual([1, 0]);
  });
});
