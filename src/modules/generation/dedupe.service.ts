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
  embedding: number[];
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

    const vectors = await this.embeddings.embed(candidates.map((c) => c.text));
    const existing = await this.loadExisting();

    const kept: EmbeddedQuestion[] = [];
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
