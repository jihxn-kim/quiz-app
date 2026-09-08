import { Test } from '@nestjs/testing';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { JudgeService } from './judge.service';

const good = { variance: 4, accessibility: 5, concreteness: 5, curiosity: 4, reason: '좋음' };

describe('JudgeService', () => {
  let service: JudgeService;
  const llm = { completeJson: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [JudgeService, { provide: LlmClient, useValue: llm }],
    }).compile();
    service = moduleRef.get(JudgeService);
  });

  describe('passes', () => {
    it('평균 3.5 이상이고 variance 3 이상이면 통과', () => {
      expect(JudgeService.passes(good)).toBe(true);
    });

    it('평균은 넘어도 variance 가 3 미만이면 탈락', () => {
      expect(
        JudgeService.passes({ ...good, variance: 2, accessibility: 5, concreteness: 5, curiosity: 5 }),
      ).toBe(false);
    });

    it('variance 는 높아도 평균이 3.5 미만이면 탈락', () => {
      expect(
        JudgeService.passes({ variance: 5, accessibility: 2, concreteness: 2, curiosity: 2, reason: '' }),
      ).toBe(false);
    });

    it('평균이 정확히 3.5 면 통과', () => {
      expect(
        JudgeService.passes({ variance: 3, accessibility: 4, concreteness: 3, curiosity: 4, reason: '' }),
      ).toBe(true);
    });
  });

  describe('score', () => {
    it('index 순서에 맞춰 점수를 돌려준다', async () => {
      llm.completeJson.mockResolvedValue({
        items: [
          { index: 1, ...good, reason: '두번째' },
          { index: 0, ...good, reason: '첫번째' },
        ],
      });

      const result = await service.score(['A?', 'B?']);

      expect(result[0]?.reason).toBe('첫번째');
      expect(result[1]?.reason).toBe('두번째');
    });

    it('20개씩 나눠 호출한다', async () => {
      llm.completeJson.mockResolvedValue({ items: [] });

      await service.score(Array.from({ length: 45 }, (_, i) => `Q${i}?`));

      expect(llm.completeJson).toHaveBeenCalledTimes(3);
    });

    it('누락된 index 는 null 로 남긴다', async () => {
      llm.completeJson.mockResolvedValue({
        items: [{ index: 0, ...good }],
      });

      const result = await service.score(['A?', 'B?']);

      expect(result[0]).not.toBeNull();
      expect(result[1]).toBeNull();
    });

    it('범위 밖 index 는 무시한다', async () => {
      llm.completeJson.mockResolvedValue({
        items: [{ index: 99, ...good }],
      });

      const result = await service.score(['A?']);

      expect(result).toEqual([null]);
    });

    it('한 묶음이 실패해도 나머지는 채점한다', async () => {
      llm.completeJson
        .mockRejectedValueOnce(new Error('실패'))
        .mockResolvedValue({ items: [{ index: 0, ...good }] });

      const result = await service.score(Array.from({ length: 21 }, (_, i) => `Q${i}?`));

      expect(result.slice(0, 20).every((r) => r === null)).toBe(true);
      expect(result[20]).not.toBeNull();
    });

    it('빈 입력이면 LLM 을 호출하지 않는다', async () => {
      await expect(service.score([])).resolves.toEqual([]);
      expect(llm.completeJson).not.toHaveBeenCalled();
    });
  });
});
