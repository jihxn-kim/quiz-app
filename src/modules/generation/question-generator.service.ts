import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mapWithConcurrency } from 'src/common/utils/concurrency';
import { shuffle } from 'src/common/utils/shuffle';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { SeedCombinationDto } from 'src/modules/seeds/seed-combination.service';
import { FORMAT_RULES, buildUserPrompt } from './prompts/format.prompts';
import { buildSystemPrompt } from './prompts/shared.prompt';
import {
  GeneratedQuestion,
  GeneratedQuestionsSchema,
} from './schemas/generated-question.schema';

export const SEEDS_PER_REQUEST = 10;
export const GOLDEN_SAMPLE_SIZE = 5;
const CONCURRENCY = 4;

@Injectable()
export class QuestionGeneratorService {
  private readonly logger = new Logger(QuestionGeneratorService.name);

  constructor(
    private readonly llm: LlmClient,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async generate(
    format: QuestionFormat,
    combos: SeedCombinationDto[],
    variantsPerSeed: number,
  ): Promise<GeneratedQuestion[]> {
    if (combos.length === 0) return [];

    const goldenPool = await this.loadGoldenPool(format);
    const chunks = this.chunk(combos, SEEDS_PER_REQUEST);
    const validHashes = new Set(combos.map((combo) => combo.seedHash));

    const perChunk = await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      try {
        const result = await this.llm.completeJson({
          // 요청마다 골든 예시를 다시 뽑는다. 고정하면 출력이 예시에 수렴한다.
          system: buildSystemPrompt({
            formatRules: FORMAT_RULES[format],
            goldenExamples: this.sampleGolden(goldenPool),
          }),
          user: buildUserPrompt({ combos: chunk, variantsPerSeed }),
          schema: GeneratedQuestionsSchema,
          schemaName: 'generated_questions',
        });
        return result.items;
      } catch (error) {
        this.logger.warn(`생성 요청 실패, 이 묶음은 건너뜁니다: ${String(error)}`);
        return [];
      }
    });

    return perChunk
      .flat()
      .filter((item) => validHashes.has(item.seedHash));
  }

  private async loadGoldenPool(format: QuestionFormat): Promise<string[]> {
    const rows = await this.questions.find({
      where: { format, golden: true },
      select: { text: true },
    });
    return rows.map((row) => row.text);
  }

  private sampleGolden(pool: string[]): string[] {
    return shuffle(pool).slice(0, GOLDEN_SAMPLE_SIZE);
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
