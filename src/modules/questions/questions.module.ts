import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerationBatch } from './entities/generation-batch.entity';
import { Question } from './entities/question.entity';
import { QuestionStat } from './entities/question-stat.entity';
import { SeedAxis } from './entities/seed-axis.entity';
import { SeedCombination } from './entities/seed-combination.entity';

const ENTITIES = [
  Question,
  QuestionStat,
  SeedAxis,
  SeedCombination,
  GenerationBatch,
];

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  exports: [TypeOrmModule],
})
export class QuestionsModule {}
