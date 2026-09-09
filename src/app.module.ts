import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'src/common/config/env.schema';
import { NoStoreMiddleware } from 'src/common/middleware/no-store.middleware';
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
export class AppModule implements NestModule {
  // 미들웨어로 모듈 그래프에 등록해야 main.ts 부트스트랩뿐 아니라
  // Test.createTestingModule({ imports: [AppModule] }) 로 앱을 띄우는
  // e2e 테스트에서도 똑같이 적용된다.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(NoStoreMiddleware).forRoutes('*');
  }
}
