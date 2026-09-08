import { Module } from '@nestjs/common';
import { LlmModule } from 'src/infrastructure/llm/llm.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedsModule } from 'src/modules/seeds/seeds.module';
import { GenerateCommand } from './commands/generate.command';
import { QuestionGeneratorService } from './question-generator.service';
import { DedupeService } from './dedupe.service';
import { GenerationPipelineService } from './generation-pipeline.service';
import { JudgeService } from './judge.service';
import { SafetyService } from './safety.service';

@Module({
  imports: [LlmModule, QuestionsModule, SeedsModule],
  providers: [
    QuestionGeneratorService,
    DedupeService,
    JudgeService,
    SafetyService,
    GenerationPipelineService,
    GenerateCommand,
  ],
  exports: [QuestionGeneratorService, DedupeService, JudgeService, SafetyService],
})
export class GenerationModule {}
