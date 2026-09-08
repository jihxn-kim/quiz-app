import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
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
/** 은퇴 후에도 서빙 가능한 live 질문이 이 아래로 떨어지면 은퇴를 보류한다. */
export const MIN_LIVE_POOL = 50;
/** 골든으로 승격 가능한 상태. rejected/retired 는 승격 대상이 아니다. */
const PROMOTABLE_STATUSES = [QuestionStatus.LIVE, QuestionStatus.APPROVED];

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

  /** 라운드가 시작되어 이 질문이 사람들에게 노출됐다. */
  async recordServed(questionId: string): Promise<void> {
    const stat = await this.loadOrCreate(questionId);
    stat.served += 1;
    await this.stats.save(stat);
  }

  /** 방장이 이 질문을 넘겼다. */
  async recordSkipped(questionId: string): Promise<void> {
    const stat = await this.loadOrCreate(questionId);
    stat.skipped += 1;
    await this.stats.save(stat);
  }

  /** 한 방이 전원 답변으로 끝났을 때 호출한다. */
  async recordAnswers(questionId: string, answers: string[]): Promise<void> {
    if (answers.length === 0) return;

    const vectors = await this.embeddings.embed(answers);
    const stat = await this.loadOrCreate(questionId);

    // 누적 평균으로 갱신한다. 덮어쓰면 MIN_SERVED 표본 가드가 무의미해진다 —
    // 200번 서빙된 질문이 마지막 한 방의 분산만으로 승격/은퇴될 수 있다.
    const previousCompleted = stat.completed;
    stat.completed += 1;

    const roomVariance = meanPairwiseDistance(vectors);
    stat.answerVariance =
      ((stat.answerVariance ?? 0) * previousCompleted + roomVariance) /
      stat.completed;

    const roomAvgLen =
      answers.reduce((sum, answer) => sum + answer.length, 0) / answers.length;
    stat.avgAnswerLen =
      ((stat.avgAnswerLen ?? 0) * previousCompleted + roomAvgLen) /
      stat.completed;

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

    if (ids.length === 0) return 0;

    // rejected/retired 는 이미 golden 이었더라도 다시 골든이 될 수 없다 —
    // 여기서 상태를 한 번 더 걸러 rejected 질문이 few-shot 예시로 계속
    // 주입되는 일을 막는다. ids.length 가 아니라 실제로 반영된 행 수를
    // 반환해야 로그와 반환값이 거짓말을 하지 않는다.
    const result = await this.questions.update(
      { id: In(ids), status: In(PROMOTABLE_STATUSES) },
      { golden: true },
    );
    const affected = result.affected ?? 0;
    this.logger.log(`골든 승격 ${affected}건`);
    return affected;
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

    if (ids.length === 0) return 0;

    // 은퇴 후 남는 live 풀이 최소 보유량 아래로 떨어지면 아무것도 은퇴시키지
    // 않는다. 컷오프가 상대적이라 후보가 있으면 항상 뭔가 은퇴시키게 되는데,
    // 그러다 살아있는 질문이 세 개 남아도 계속 깎일 수 있다.
    const liveCount = await this.questions.count({
      where: { status: QuestionStatus.LIVE },
    });
    if (liveCount - ids.length < MIN_LIVE_POOL) {
      this.logger.warn(
        `은퇴 보류: live ${liveCount}건에서 ${ids.length}건을 은퇴시키면 최소 보유량 ${MIN_LIVE_POOL}건 아래로 떨어집니다`,
      );
      return 0;
    }

    // 은퇴하는 질문은 golden 플래그도 함께 내린다 — 그렇지 않으면 은퇴한
    // 질문이 loadGoldenPool 에서 계속 few-shot 예시로 뽑힌다.
    await this.questions.update(ids, { status: QuestionStatus.RETIRED, golden: false });
    this.logger.log(`은퇴 처리 ${ids.length}건`);
    return ids.length;
  }

  private async loadOrCreate(questionId: string): Promise<QuestionStat> {
    return (
      (await this.stats.findOne({ where: { questionId } })) ??
      this.stats.create({ questionId, served: 0, completed: 0, skipped: 0 })
    );
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
