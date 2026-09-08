import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('quiz-app API')
    .setDescription('친구들끼리 각자 답을 적고 전원 제출 시 동시에 공개하는 질문 게임')
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-Participant-Token', in: 'header' },
      'participantToken',
    )
    .build();
  SwaggerModule.setup('api-docs', app, SwaggerModule.createDocument(app, config));

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
