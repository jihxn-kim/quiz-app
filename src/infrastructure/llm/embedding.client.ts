import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
const BATCH_SIZE = 100;

@Injectable()
export class EmbeddingClient {
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
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: slice,
      });
      // API 가 순서를 보장하지 않으므로 index 로 재정렬한다.
      const ordered = new Array<number[]>(slice.length);
      for (const item of response.data) {
        ordered[item.index] = item.embedding as number[];
      }
      results.push(...ordered);
    }
    return results;
  }
}
