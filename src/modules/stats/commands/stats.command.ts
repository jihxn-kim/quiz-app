import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { QuestionStatsService } from '../question-stats.service';

@Command({
  name: 'stats',
  description: '실사용 통계로 골든 승격과 은퇴를 처리한다',
})
export class StatsCommand extends CommandRunner {
  private readonly logger = new Logger(StatsCommand.name);

  constructor(private readonly stats: QuestionStatsService) {
    super();
  }

  async run(): Promise<void> {
    const promoted = await this.stats.promoteGolden();
    const retired = await this.stats.retireUnderperformers();
    this.logger.log(`골든 승격 ${promoted}건, 은퇴 ${retired}건`);
  }
}
