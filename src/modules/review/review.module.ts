import { Module } from '@nestjs/common';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { ReviewCommand } from './commands/review.command';
import { ReviewService } from './review.service';

@Module({
  imports: [QuestionsModule],
  providers: [ReviewService, ReviewCommand],
  exports: [ReviewService],
})
export class ReviewModule {}
