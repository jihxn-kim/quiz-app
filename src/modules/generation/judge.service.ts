import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from 'src/common/utils/concurrency';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { JudgeScores } from 'src/modules/questions/entities/question.entity';
import {
  JudgeScoresSchema,
  JudgeScoreItem,
} from './schemas/judge-scores.schema';
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPrompt,
} from './prompts/judge.prompt';

export const JUDGE_BATCH_SIZE = 20;
export const MIN_AVERAGE = 3.5;
export const MIN_VARIANCE = 3;
const CONCURRENCY = 4;

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(private readonly llm: LlmClient) {}

  static passes(scores: JudgeScores): boolean {
    const average =
      (scores.variance +
        scores.accessibility +
        scores.concreteness +
        scores.curiosity) /
      4;
    return average >= MIN_AVERAGE && scores.variance >= MIN_VARIANCE;
  }

  /** 실패하거나 누락된 항목은 null 로 남긴다. 호출자가 사람 검수로 보낸다. */
  async score(texts: string[]): Promise<(JudgeScores | null)[]> {
    if (texts.length === 0) return [];

    const results = new Array<JudgeScores | null>(texts.length).fill(null);
    const chunks: { offset: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += JUDGE_BATCH_SIZE) {
      chunks.push({ offset: i, texts: texts.slice(i, i + JUDGE_BATCH_SIZE) });
    }

    await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      let items: JudgeScoreItem[];
      try {
        const response = await this.llm.completeJson({
          system: JUDGE_SYSTEM_PROMPT,
          user: buildJudgeUserPrompt(chunk.texts),
          schema: JudgeScoresSchema,
          schemaName: 'judge_scores',
        });
        items = response.items;
      } catch (error) {
        this.logger.warn(`심사 실패, 이 묶음은 검수로 넘깁니다: ${String(error)}`);
        return;
      }

      for (const item of items) {
        if (item.index < 0 || item.index >= chunk.texts.length) continue;
        results[chunk.offset + item.index] = {
          variance: item.variance,
          accessibility: item.accessibility,
          concreteness: item.concreteness,
          curiosity: item.curiosity,
          reason: item.reason,
        };
      }
    });

    return results;
  }
}
