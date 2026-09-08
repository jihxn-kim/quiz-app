import { Module } from '@nestjs/common';
import { LlmModule } from 'src/infrastructure/llm/llm.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedsModule } from 'src/modules/seeds/seeds.module';
import { QuestionGeneratorService } from './question-generator.service';
import { DedupeService } from './dedupe.service';
import { JudgeService } from './judge.service';

@Module({
  imports: [LlmModule, QuestionsModule, SeedsModule],
  providers: [QuestionGeneratorService, DedupeService, JudgeService],
  exports: [QuestionGeneratorService, DedupeService, JudgeService],
})
export class GenerationModule {}
