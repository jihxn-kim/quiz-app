import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { meanPairwiseDistance } from 'src/common/utils/cosine';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStat } from 'src/modules/questions/entities/question-stat.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';

export const MIN_SERVED = 30;
export const MAX_SKIP_RATE_FOR_GOLDEN = 0.1;
export const MIN_COMPLETION_RATE_FOR_GOLDEN = 0.7;
export const RETIRE_SKIP_RATE = 0.3;
export const GOLDEN_TOP_RATIO = 0.2;
export const RETIRE_BOTTOM_RATIO = 0.1;

@Injectable()
export class QuestionStatsService {
  private readonly logger = new Logger(QuestionStatsService.name);

  constructor(
    private readonly embeddings: EmbeddingClient,
    @InjectRepository(QuestionStat)
    private readonly stats: Repository<QuestionStat>,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  /** 한 방이 전원 답변으로 끝났을 때 호출한다. */
  async recordAnswers(questionId: string, answers: string[]): Promise<void> {
    if (answers.length === 0) return;

    const vectors = await this.embeddings.embed(answers);
    const stat =
      (await this.stats.findOne({ where: { questionId } })) ??
      this.stats.create({ questionId, served: 0, completed: 0, skipped: 0 });

    stat.completed += 1;
    stat.answerVariance = meanPairwiseDistance(vectors);
    stat.avgAnswerLen =
      answers.reduce((sum, answer) => sum + answer.length, 0) / answers.length;

    await this.stats.save(stat);
  }

  async promoteGolden(): Promise<number> {
    const rows = await this.stats.find({
      where: { served: MoreThanOrEqual(MIN_SERVED) },
    });
    const cutoff = this.varianceCutoff(rows, GOLDEN_TOP_RATIO, 'top');

    const ids = rows
      .filter((row) => {
        // 쿼리에도 조건이 있지만 여기서 한 번 더 막는다. 승격 기준은
        // 최소 서빙 횟수를 넘긴 질문에만 적용되어야 한다.
        if (row.served < MIN_SERVED) return false;
        const variance = row.answerVariance ?? 0;
        const skipRate = row.skipped / row.served;
        const completionRate = row.completed / row.served;
        return (
          variance >= cutoff &&
          skipRate < MAX_SKIP_RATE_FOR_GOLDEN &&
          completionRate > MIN_COMPLETION_RATE_FOR_GOLDEN
        );
      })
      .map((row) => row.questionId);

    if (ids.length > 0) {
      await this.questions.update(ids, { golden: true });
      this.logger.log(`골든 승격 ${ids.length}건`);
    }
    return ids.length;
  }

  async retireUnderperformers(): Promise<number> {
    const rows = await this.stats.find({
      where: { served: MoreThanOrEqual(MIN_SERVED) },
    });
    const cutoff = this.varianceCutoff(rows, RETIRE_BOTTOM_RATIO, 'bottom');

    const ids = rows
      .filter((row) => {
        if (row.served < MIN_SERVED) return false;
        const variance = row.answerVariance ?? 0;
        const skipRate = row.skipped / row.served;
        return variance <= cutoff || skipRate > RETIRE_SKIP_RATE;
      })
      .map((row) => row.questionId);

    if (ids.length > 0) {
      await this.questions.update(ids, { status: QuestionStatus.RETIRED });
      this.logger.log(`은퇴 처리 ${ids.length}건`);
    }
    return ids.length;
  }

  /** 분산도 기준 상위/하위 컷오프 값 */
  private varianceCutoff(
    rows: QuestionStat[],
    ratio: number,
    end: 'top' | 'bottom',
  ): number {
    if (rows.length === 0) return end === 'top' ? Infinity : -Infinity;
    const sorted = rows
      .map((row) => row.answerVariance ?? 0)
      .sort((a, b) => b - a);
    const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
    return end === 'top' ? sorted[index] : sorted[sorted.length - 1 - index];
  }
}
