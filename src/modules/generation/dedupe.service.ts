import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { cosineSimilarity } from 'src/common/utils/cosine';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { GeneratedQuestion } from './schemas/generated-question.schema';

export const DUPLICATE_THRESHOLD = 0.85;

export interface EmbeddedQuestion extends GeneratedQuestion {
  // 임베딩이 실패하면 중복 제거를 건너뛰고 null 임베딩으로 통과시킨다 —
  // 그 질문은 반드시 사람 검수를 거치게 된다.
  embedding: number[] | null;
}

export interface DedupeResult {
  kept: EmbeddedQuestion[];
  dropped: { text: string; similarity: number; against: string }[];
}

@Injectable()
export class DedupeService {
  private readonly logger = new Logger(DedupeService.name);

  constructor(
    private readonly embeddings: EmbeddingClient,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async filter(candidates: GeneratedQuestion[]): Promise<DedupeResult> {
    if (candidates.length === 0) return { kept: [], dropped: [] };

    let vectors: number[][];
    try {
      vectors = await this.embeddings.embed(candidates.map((c) => c.text));
    } catch (error) {
      // 스펙의 에러 처리 방침: 임베딩이 실패하면 중복 제거를 건너뛰고
      // 후보 전부를 pending 으로 통과시켜 사람 검수로 보낸다. 여기서 그냥
      // 던지면 이미 비용을 지불한 생성 결과가 배치째로 사라진다.
      this.logger.warn(
        `임베딩 실패로 중복 제거를 건너뜁니다. 후보 전부를 임베딩 없이 통과시킵니다: ${String(error)}`,
      );
      return {
        kept: candidates.map((c) => ({ ...c, embedding: null })),
        dropped: [],
      };
    }

    const existing = await this.loadExisting();

    const kept: (GeneratedQuestion & { embedding: number[] })[] = [];
    const dropped: DedupeResult['dropped'] = [];

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = { ...candidates[i], embedding: vectors[i] };
      // 기존 풀과 이번 배치에서 이미 남긴 것 둘 다와 비교한다.
      const pool = [
        ...existing,
        ...kept.map((k) => ({ text: k.text, embedding: k.embedding })),
      ];

      const match = this.findMostSimilar(candidate.embedding, pool);
      if (match !== null && match.similarity > DUPLICATE_THRESHOLD) {
        dropped.push({
          text: candidate.text,
          similarity: match.similarity,
          against: match.text,
        });
        continue;
      }
      kept.push(candidate);
    }

    this.logger.log(`중복 제거: ${candidates.length}개 중 ${kept.length}개 남김`);
    return { kept, dropped };
  }

  private async loadExisting(): Promise<{ text: string; embedding: number[] }[]> {
    const rows = await this.questions.find({
      where: { status: Not(QuestionStatus.REJECTED) },
      select: { text: true, embedding: true },
    });
    return rows
      .filter((row): row is Question & { embedding: number[] } =>
        Array.isArray(row.embedding) && row.embedding.length > 0,
      )
      .map((row) => ({ text: row.text, embedding: row.embedding }));
  }

  private findMostSimilar(
    target: number[],
    pool: { text: string; embedding: number[] }[],
  ): { text: string; similarity: number } | null {
    let best: { text: string; similarity: number } | null = null;
    for (const item of pool) {
      const similarity = cosineSimilarity(target, item.embedding);
      if (best === null || similarity > best.similarity) {
        best = { text: item.text, similarity };
      }
    }
    return best;
  }
}
