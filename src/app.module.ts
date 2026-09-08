import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'src/common/config/env.schema';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { GenerationModule } from 'src/modules/generation/generation.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedsModule } from 'src/modules/seeds/seeds.module';

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
  ],
})
export class AppModule {}
