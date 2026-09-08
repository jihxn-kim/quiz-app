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
