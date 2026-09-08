import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenerationBatch } from 'src/modules/questions/entities/generation-batch.entity';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { VARIANTS_PER_SEED } from 'src/modules/seeds/data/axis-values';
import { SeedCombinationService } from 'src/modules/seeds/seed-combination.service';
import { DedupeService } from './dedupe.service';
import { JudgeService } from './judge.service';
import { QuestionGeneratorService } from './question-generator.service';
import { SafetyService } from './safety.service';

export interface PipelineSummary {
  batchId: string;
  seedCount: number;
  generated: number;
  deduped: number;
  judgePassed: number;
  safetyPassed: number;
  saved: number;
}

@Injectable()
export class GenerationPipelineService {
  private readonly logger = new Logger(GenerationPipelineService.name);

  constructor(
    private readonly seeds: SeedCombinationService,
    private readonly generator: QuestionGeneratorService,
    private readonly dedupe: DedupeService,
    private readonly judge: JudgeService,
    private readonly safety: SafetyService,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    @InjectRepository(GenerationBatch)
    private readonly batches: Repository<GenerationBatch>,
  ) {}

  async run(format: QuestionFormat, seedLimit: number): Promise<PipelineSummary> {
    const batchId = randomUUID();
    const combos = await this.seeds.drawUnused(format, seedLimit);

    const batch = this.batches.create({
      id: batchId,
      format,
      seedCount: combos.length,
    });
    await this.batches.save(batch);

    if (combos.length === 0) {
      this.logger.warn(`${format}: 미사용 시드 조합이 없습니다. 축 테이블 확장이 필요합니다.`);
      batch.finishedAt = new Date();
      await this.batches.save(batch);
      return {
        batchId, seedCount: 0, generated: 0, deduped: 0,
        judgePassed: 0, safetyPassed: 0, saved: 0,
      };
    }

    try {
      const generated = await this.generator.generate(
        format,
        combos,
        VARIANTS_PER_SEED[format],
      );
      batch.generated = generated.length;

      const { kept } = await this.dedupe.filter(generated);
      batch.deduped = kept.length;

      const texts = kept.map((item) => item.text);
      const [scores, verdicts] = await Promise.all([
        this.judge.score(texts),
        this.safety.check(texts),
      ]);

      const rows: Question[] = [];
      for (let i = 0; i < kept.length; i += 1) {
        const item = kept[i];
        const score = scores[i];
        const verdict = verdicts[i];

        // 안전 탈락은 버리지 않고 rejected 로 남겨 프롬프트 보강에 쓴다.
        if (verdict?.passed === false) {
          rows.push(this.buildRow(item, batchId, format, {
            status: QuestionStatus.REJECTED,
            judgeScores: score,
            safetyPassed: false,
            safetyReason: verdict.reason,
          }));
          continue;
        }

        // 판정이 없으면(null) 자동 통과시키지 않고 사람 검수로 보낸다.
        const undetermined = score === null || verdict === null;
        if (!undetermined && !JudgeService.passes(score)) continue;

        rows.push(this.buildRow(item, batchId, format, {
          status: QuestionStatus.PENDING,
          judgeScores: score,
          safetyPassed: verdict === null ? null : true,
          safetyReason: verdict?.reason ?? null,
        }));
      }

      batch.judgePassed = scores.filter(
        (score) => score !== null && JudgeService.passes(score),
      ).length;
      batch.safetyPassed = verdicts.filter((v) => v?.passed === true).length;

      // 생성 후보가 실제로 나온 시드만 소모한다. 요청이 전부 실패해 아무것도
      // 생성되지 않았다면 그 시드는 다시 뽑힐 수 있어야 한다 — 조합 공간이
      // 작은 형식(confession 8개)은 실패한 배치 두 번이면 영원히 고갈된다.
      const usedHashes = new Set(generated.map((item) => item.seedHash));
      const usedCombos = combos.filter((combo) => usedHashes.has(combo.seedHash));

      // 순서 중요: questions.seed_hash 가 seed_combinations 를 참조하는 FK 이므로
      // 조합을 먼저 기록해야 질문 저장이 FK 위반으로 실패하지 않는다.
      await this.seeds.markUsed(usedCombos);
      if (rows.length > 0) await this.questions.save(rows);

      batch.finishedAt = new Date();
      await this.batches.save(batch);

      const summary: PipelineSummary = {
        batchId,
        seedCount: combos.length,
        generated: batch.generated,
        deduped: batch.deduped,
        judgePassed: batch.judgePassed,
        safetyPassed: batch.safetyPassed,
        saved: rows.length,
      };
      this.logger.log(`배치 완료: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      batch.error = String(error);
      batch.finishedAt = new Date();
      await this.batches.save(batch);
      throw error;
    }
  }

  private buildRow(
    item: { text: string; topicTags: string[]; seedHash: string; embedding: number[] | null },
    batchId: string,
    format: QuestionFormat,
    overrides: Partial<Question>,
  ): Question {
    return this.questions.create({
      text: item.text,
      format,
      topicTags: item.topicTags,
      seedHash: item.seedHash,
      embedding: item.embedding,
      batchId,
      ...overrides,
    });
  }
}
