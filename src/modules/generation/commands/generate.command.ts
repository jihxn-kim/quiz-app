import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import {
  ALL_FORMATS,
  QuestionFormat,
} from 'src/modules/questions/enums/question-format.enum';
import { GenerationPipelineService } from '../generation-pipeline.service';

interface GenerateOptions {
  format?: QuestionFormat;
  seeds: number;
}

@Command({ name: 'generate', description: '질문 생성 파이프라인을 실행한다' })
export class GenerateCommand extends CommandRunner {
  private readonly logger = new Logger(GenerateCommand.name);

  constructor(private readonly pipeline: GenerationPipelineService) {
    super();
  }

  async run(_args: string[], options: GenerateOptions): Promise<void> {
    const formats = options.format ? [options.format] : ALL_FORMATS;
    for (const format of formats) {
      const summary = await this.pipeline.run(format, options.seeds);
      this.logger.log(
        `[${format}] 시드 ${summary.seedCount} -> 생성 ${summary.generated} -> ` +
          `중복제거 ${summary.deduped} -> 심사통과 ${summary.judgePassed} -> 저장 ${summary.saved}`,
      );
    }
  }

  @Option({
    flags: '-f, --format <format>',
    description: 'constraint | dilemma | projection | confession (생략하면 전체)',
  })
  parseFormat(value: string): QuestionFormat {
    if (!ALL_FORMATS.includes(value as QuestionFormat)) {
      throw new Error(`알 수 없는 형식: ${value}`);
    }
    return value as QuestionFormat;
  }

  @Option({
    flags: '-s, --seeds <count>',
    description: '이번 배치에서 소비할 시드 조합 수 (기본 10)',
    defaultValue: 10,
  })
  parseSeeds(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error(`시드 수는 양의 정수여야 합니다: ${value}`);
    }
    return parsed;
  }
}
