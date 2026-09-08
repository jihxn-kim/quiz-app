import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Command, CommandRunner } from 'nest-commander';
import { Repository } from 'typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { SeedAxis } from 'src/modules/questions/entities/seed-axis.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { AXIS_VALUES } from '../data/axis-values';
import { GOLDEN_QUESTIONS } from '../data/golden-questions';

@Command({ name: 'seed', description: '축 테이블과 골든 질문을 적재한다' })
export class SeedCommand extends CommandRunner {
  private readonly logger = new Logger(SeedCommand.name);

  constructor(
    @InjectRepository(SeedAxis) private readonly axes: Repository<SeedAxis>,
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    private readonly embeddings: EmbeddingClient,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.seedAxes();
    await this.seedGolden();
    this.logger.log('시드 적재 완료');
  }

  private async seedAxes(): Promise<void> {
    const rows = Object.entries(AXIS_VALUES).flatMap(([format, axes]) =>
      Object.entries(axes).flatMap(([axisName, values]) =>
        values.map((value) => ({
          format: format as QuestionFormat,
          axisName,
          value,
          active: true,
        })),
      ),
    );
    await this.axes.upsert(rows, ['format', 'axisName', 'value']);
    this.logger.log(`축 값 ${rows.length}개 적재`);
  }

  private async seedGolden(): Promise<void> {
    const existing = await this.questions.find({
      where: { golden: true },
      select: { text: true },
    });
    const existingTexts = new Set(existing.map((row) => row.text));
    const fresh = GOLDEN_QUESTIONS.filter((q) => !existingTexts.has(q.text));

    if (fresh.length === 0) {
      this.logger.log('새로 적재할 골든 질문 없음');
      return;
    }

    const vectors = await this.embeddings.embed(fresh.map((q) => q.text));
    await this.questions.save(
      fresh.map((q, index) =>
        this.questions.create({
          text: q.text,
          format: q.format,
          topicTags: q.topicTags,
          embedding: vectors[index],
          status: QuestionStatus.LIVE,
          golden: true,
        }),
      ),
    );
    this.logger.log(`골든 질문 ${fresh.length}개 적재`);
  }
}
