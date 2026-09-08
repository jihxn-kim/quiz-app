import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'src/common/config/env.schema';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { GameModule } from 'src/modules/game/game.module';
import { GenerationModule } from 'src/modules/generation/generation.module';
import { HealthModule } from 'src/modules/health/health.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { ReviewModule } from 'src/modules/review/review.module';
import { SeedsModule } from 'src/modules/seeds/seeds.module';
import { StatsModule } from 'src/modules/stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    QuestionsModule,
    SeedsModule,
    GenerationModule,
    ReviewModule,
    StatsModule,
    HealthModule,
    GameModule,
  ],
})
export class AppModule {}
