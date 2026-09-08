import { Module } from '@nestjs/common';
import { LlmModule } from 'src/infrastructure/llm/llm.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedCommand } from './commands/seed.command';
import { SeedCombinationService } from './seed-combination.service';

@Module({
  imports: [QuestionsModule, LlmModule],
  providers: [SeedCombinationService, SeedCommand],
  exports: [SeedCombinationService],
})
export class SeedsModule {}
