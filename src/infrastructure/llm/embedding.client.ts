import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

@Injectable()
export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
    });
  }

  /** 입력 순서를 보존해 임베딩을 반환한다. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const slice = texts.slice(offset, offset + BATCH_SIZE);
      // 배치 단위로 재시도한다 — 여기서 전체 루프를 감싸면 이미 성공한
      // 앞선 배치까지 실패한 배치 하나 때문에 전부 다시 보내게 된다.
      const ordered = await this.embedBatchWithRetry(slice);
      results.push(...ordered);
    }
    return results;
  }

  private async embedBatchWithRetry(slice: string[]): Promise<number[][]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: slice,
        });
        return this.reorderAndValidate(response.data, slice.length);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `임베딩 호출 실패 (${attempt}/${MAX_ATTEMPTS}): ${String(error)}`,
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

  /**
   * API 는 입력 순서를 보장하지 않으므로 index 로 재정렬한다. 동시에
   * 응답이 요청과 정확히 같은 개수의 벡터를 담고 있는지, 구멍(undefined)
   * 없이 채워졌는지, 각 벡터 차원이 EMBEDDING_DIM 과 일치하는지 검증한다.
   * 여기서 조용히 넘어가면 undefined 가 결과 배열에 섞여 들어가
   * cosineSimilarity 에서 배치 전체가 죽거나, NULL 임베딩이 이후 모든
   * dedupe 패스에서 영원히 보이지 않는 채로 저장된다.
   */
  private reorderAndValidate(
    data: { index: number; embedding: number[] }[],
    expected: number,
  ): number[][] {
    if (data.length !== expected) {
      throw new Error(
        `임베딩 응답 개수가 요청과 다릅니다: 요청 ${expected}개, 응답 ${data.length}개`,
      );
    }

    const ordered = new Array<number[]>(expected);
    for (const item of data) {
      ordered[item.index] = item.embedding as number[];
    }

    for (let i = 0; i < ordered.length; i += 1) {
      const vector = ordered[i];
      if (vector === undefined) {
        throw new Error(`임베딩 응답에 ${i}번째 벡터가 없습니다 (index 누락 또는 중복)`);
      }
      if (vector.length !== EMBEDDING_DIM) {
        throw new Error(
          `임베딩 벡터 길이가 올바르지 않습니다 (index ${i}): 기대 ${EMBEDDING_DIM}, 실제 ${vector.length}`,
        );
      }
    }

    return ordered;
  }
}
