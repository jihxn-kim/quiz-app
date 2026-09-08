import { Test } from '@nestjs/testing';
import { LlmClient, LlmRefusalError } from 'src/infrastructure/llm/llm.client';
import { SafetyService } from './safety.service';

describe('SafetyService', () => {
  let service: SafetyService;
  const llm = { completeJson: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SafetyService, { provide: LlmClient, useValue: llm }],
    }).compile();
    service = moduleRef.get(SafetyService);
  });

  it('index 순서에 맞춰 판정을 돌려준다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [
        { index: 1, passed: false, reason: '동정 요구' },
        { index: 0, passed: true, reason: '진지한 호기심' },
      ],
    });

    const result = await service.check(['A?', 'B?']);

    expect(result[0]).toEqual({ passed: true, reason: '진지한 호기심' });
    expect(result[1]).toEqual({ passed: false, reason: '동정 요구' });
  });

  it('20개씩 나눠 호출한다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.check(Array.from({ length: 41 }, (_, i) => `Q${i}?`));

    expect(llm.completeJson).toHaveBeenCalledTimes(3);
  });

  it('청크 경계를 넘어 판정을 올바른 전역 위치에 매핑한다', async () => {
    // 21개 -> 청크 2개(offset 0, 20). 두 번째 청크의 chunk-local index 0 은
    // 전역 20번 슬롯에 들어가야 한다. 오프셋을 빠뜨리면 0번을 덮어써서
    // 이미 "탈락"으로 판정된 질문이 조용히 "통과"로 뒤집힌다.
    // 안전 필터에서 이건 미판정(null)보다 훨씬 나쁜 실패다.
    llm.completeJson
      .mockResolvedValueOnce({
        items: [{ index: 0, passed: false, reason: '첫 청크 탈락' }],
      })
      .mockResolvedValueOnce({
        items: [{ index: 0, passed: true, reason: '두 번째 청크 통과' }],
      });

    const result = await service.check(
      Array.from({ length: 21 }, (_, i) => `Q${i}?`),
    );

    expect(result[0]).toEqual({ passed: false, reason: '첫 청크 탈락' });
    expect(result[20]).toEqual({ passed: true, reason: '두 번째 청크 통과' });
    expect(result.slice(1, 20).every((v) => v === null)).toBe(true);
  });

  it('누락된 index 는 null 로 남겨 사람 검수로 보낸다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [{ index: 0, passed: true, reason: 'ok' }],
    });

    const result = await service.check(['A?', 'B?']);

    expect(result[1]).toBeNull();
  });

  it('LLM 이 거절하면 그 묶음 전체를 null 로 남긴다', async () => {
    llm.completeJson.mockRejectedValue(new LlmRefusalError('harmful'));

    const result = await service.check(['A?', 'B?']);

    expect(result).toEqual([null, null]);
  });

  it('빈 입력이면 LLM 을 호출하지 않는다', async () => {
    await expect(service.check([])).resolves.toEqual([]);
    expect(llm.completeJson).not.toHaveBeenCalled();
  });
});
