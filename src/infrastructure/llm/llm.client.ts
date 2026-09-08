import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { z } from 'zod';
import { toStrictJsonSchema } from './json-schema';

export const LLM_MODEL = 'gpt-5.5';
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

/** 모델이 요청을 거절한 경우. 재시도해도 결과가 같으므로 즉시 던진다. */
export class LlmRefusalError extends Error {
  constructor(readonly refusal: string) {
    super(`LLM 이 요청을 거절했습니다: ${refusal}`);
    this.name = 'LlmRefusalError';
  }
}

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
    });
  }

  /**
   * 구조화 출력으로 JSON 을 받는다.
   * schema 의 최상위는 반드시 객체여야 한다 (배열이면 { items: [...] } 로 감쌀 것).
   *
   * temperature 는 보내지 않는다 — gpt-5.5 는 기본값 1 이외를 400 으로 거부한다.
   * 프롬프트 캐싱은 자동이므로 캐시 지시 파라미터도 없다. 대신 변하지 않는
   * system 을 앞에, 매 요청 달라지는 user 를 뒤에 두어 접두를 안정시킨다.
   */
  async completeJson<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    schemaName: string;
    maxTokens?: number;
  }): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.openai.chat.completions.create({
          model: LLM_MODEL,
          max_completion_tokens: args.maxTokens ?? 16_000,
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: args.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: args.schemaName,
              strict: true,
              schema: toStrictJsonSchema(args.schema),
            },
          },
        });

        const message = response.choices[0]?.message;
        if (message?.refusal) {
          throw new LlmRefusalError(message.refusal);
        }
        if (!message?.content) {
          throw new Error('LLM 응답에 content 가 없습니다');
        }

        const parsed = args.schema.safeParse(JSON.parse(message.content));
        if (!parsed.success) {
          throw new Error(
            `LLM 응답이 스키마에 맞지 않습니다: ${parsed.error.message}`,
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof LlmRefusalError) throw error;
        lastError = error;
        this.logger.warn(
          `LLM 호출 실패 (${attempt}/${MAX_ATTEMPTS}): ${String(error)}`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)),
          );
        }
      }
    }

    throw lastError;
  }
}
