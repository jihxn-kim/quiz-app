import { Module } from '@nestjs/common';
import { LlmModule } from 'src/infrastructure/llm/llm.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedsModule } from 'src/modules/seeds/seeds.module';
import { QuestionGeneratorService } from './question-generator.service';

@Module({
  imports: [LlmModule, QuestionsModule, SeedsModule],
  providers: [QuestionGeneratorService],
  exports: [QuestionGeneratorService],
})
export class GenerationModule {}
