import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from 'src/common/utils/concurrency';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { SafetyVerdictsSchema } from './schemas/safety-verdict.schema';
import {
  SAFETY_SYSTEM_PROMPT,
  buildSafetyUserPrompt,
} from './prompts/safety.prompt';

export const SAFETY_BATCH_SIZE = 20;
const CONCURRENCY = 4;

export interface SafetyVerdict {
  passed: boolean;
  reason: string;
}

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(private readonly llm: LlmClient) {}

  /**
   * 판정에 실패한 항목은 null 로 남긴다.
   * 안전은 자동 통과시키면 안 되는 축이므로 호출자가 반드시 사람 검수로 보낸다.
   */
  async check(texts: string[]): Promise<(SafetyVerdict | null)[]> {
    if (texts.length === 0) return [];

    const results = new Array<SafetyVerdict | null>(texts.length).fill(null);
    const chunks: { offset: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += SAFETY_BATCH_SIZE) {
      chunks.push({ offset: i, texts: texts.slice(i, i + SAFETY_BATCH_SIZE) });
    }

    await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      try {
        const response = await this.llm.completeJson({
          system: SAFETY_SYSTEM_PROMPT,
          user: buildSafetyUserPrompt(chunk.texts),
          schema: SafetyVerdictsSchema,
          schemaName: 'safety_verdicts',
        });
        for (const item of response.items) {
          if (item.index < 0 || item.index >= chunk.texts.length) continue;
          results[chunk.offset + item.index] = {
            passed: item.passed,
            reason: item.reason,
          };
        }
      } catch (error) {
        this.logger.warn(
          `안전 판정 실패, 이 묶음은 검수로 넘깁니다: ${String(error)}`,
        );
      }
    });

    return results;
  }
}
