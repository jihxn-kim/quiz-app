import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { LlmClient } from '../src/infrastructure/llm/llm.client';
import { buildSystemPrompt } from '../src/modules/generation/prompts/shared.prompt';
import { FORMAT_RULES, buildUserPrompt } from '../src/modules/generation/prompts/format.prompts';
import { GeneratedQuestionsSchema } from '../src/modules/generation/schemas/generated-question.schema';
import { SeedCombinationService } from '../src/modules/seeds/seed-combination.service';
import { QuestionFormat } from '../src/modules/questions/enums/question-format.enum';

const GOLDEN: Record<string, string[]> = {
  constraint: [
    '시각장애인은 변을 보고 닦을 때 다 닦였는지 어떻게 확인할까?',
    '청각장애인은 자기가 코를 고는지 어떻게 알까?',
    '한쪽 손만 쓸 수 있으면 신발끈은 어떻게 묶을까?',
    '말을 못 하면 응급실에서 어디가 아픈지 어떻게 전달할까?',
    '무중력에서 라면을 끓이면 국물은 어떻게 먹을까?',
  ],
  dilemma: [
    '평생 남의 속마음이 들리는 것과 내 속마음이 다 들리는 것 중 뭐가 나을까?',
    '평생 라면만 먹기와 평생 김밥만 먹기 중 뭐를 고를까?',
    '친구가 하나도 없는 부자와 친구는 많은 가난뱅이 중 뭐가 나을까?',
  ],
  confession: [
    '부모님한테 끝까지 숨긴 것 하나만 말한다면?',
    '친구한테 질투 느낀 순간이 언제였을까?',
    '마지막으로 한 거짓말은 뭐였을까?',
  ],
};

async function run(fmt: QuestionFormat, n: number, variants: number): Promise<void> {
  const svc = new SeedCombinationService({ find: async () => [] } as never);
  const combos = svc.buildAll(fmt).sort(() => Math.random() - 0.5).slice(0, n);
  const client = new LlmClient(
    new ConfigService({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
  );
  const res = await client.completeJson({
    system: buildSystemPrompt({ formatRules: FORMAT_RULES[fmt], goldenExamples: GOLDEN[fmt] }),
    user: buildUserPrompt({ combos, variantsPerSeed: variants }),
    schema: GeneratedQuestionsSchema,
    schemaName: 'generated_questions',
  });
  console.log(`\n${'='.repeat(64)}\n[${fmt}]`);
  for (const c of combos) console.log('  시드:', Object.values(c.axisValues).join(' × '));
  console.log('-'.repeat(64));
  for (const q of res.items) console.log(`  · ${q.text}\n       (${q.topicTags.join(', ')})`);
}

(async () => {
  await run(QuestionFormat.CONSTRAINT, 3, 2);
  await run(QuestionFormat.DILEMMA, 2, 2);
  await run(QuestionFormat.CONFESSION, 2, 2);
})().catch((e) => console.error('ERR', String(e?.message).slice(0, 300)));
