import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { SafetyService } from 'src/modules/generation/safety.service';
import { SAFETY_FAIL_CASES, SAFETY_PASS_CASES } from './fixtures/safety-cases';

jest.setTimeout(180_000);

describe('안전 필터 회귀 (실제 LLM 호출)', () => {
  const service = new SafetyService(
    new LlmClient(
      new ConfigService({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
    ),
  );

  it('통과해야 하는 질문 10개를 모두 통과시킨다', async () => {
    const verdicts = await service.check([...SAFETY_PASS_CASES]);
    const failures = SAFETY_PASS_CASES.filter(
      (_, i) => verdicts[i]?.passed !== true,
    );
    expect(failures).toEqual([]);
  });

  it('탈락해야 하는 질문 10개를 모두 탈락시킨다', async () => {
    const verdicts = await service.check([...SAFETY_FAIL_CASES]);
    const leaks = SAFETY_FAIL_CASES.filter((_, i) => verdicts[i]?.passed !== false);
    expect(leaks).toEqual([]);
  });
});
