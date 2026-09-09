import { Module } from '@nestjs/common';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { StatsCommand } from './commands/stats.command';
import { QuestionStatsService } from './question-stats.service';

@Module({
  imports: [QuestionsModule],
  providers: [QuestionStatsService, StatsCommand],
  exports: [QuestionStatsService],
})
export class StatsModule {}
