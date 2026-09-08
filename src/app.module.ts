import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'src/common/config/env.schema';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    QuestionsModule,
  ],
})
export class AppModule {}
