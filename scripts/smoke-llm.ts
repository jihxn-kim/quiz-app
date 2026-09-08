import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmClient } from '../src/infrastructure/llm/llm.client';

const schema = z.object({
  items: z.array(z.object({ text: z.string(), tag: z.string() })),
});

async function main(): Promise<void> {
  const client = new LlmClient(
    new ConfigService({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
  );
  const result = await client.completeJson({
    system: '너는 테스트용 응답기다.',
    user: '아무 한국어 문장 2개를 items 로 반환해라. tag 는 test 로 채운다.',
    schema,
    schemaName: 'smoke',
    maxTokens: 2_000,
  });
  console.log(JSON.stringify(result, null, 2));
}

void main();
