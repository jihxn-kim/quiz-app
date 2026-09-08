import { Module } from '@nestjs/common';
import { LlmModule } from 'src/infrastructure/llm/llm.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { StatsCommand } from './commands/stats.command';
import { QuestionStatsService } from './question-stats.service';

@Module({
  imports: [LlmModule, QuestionsModule],
  providers: [QuestionStatsService, StatsCommand],
  exports: [QuestionStatsService],
})
export class StatsModule {}
