import { Module } from '@nestjs/common';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedCombinationService } from './seed-combination.service';

@Module({
  imports: [QuestionsModule],
  providers: [SeedCombinationService],
  exports: [SeedCombinationService],
})
export class SeedsModule {}
