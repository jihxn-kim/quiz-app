import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PARTICIPANT_TOKEN_HEADER } from 'src/modules/game/auth/participant.guard';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // 모든 응답에 Cache-Control: no-store 를 붙이므로(AppModule 의
  // NoStoreMiddleware) 브라우저가 아무것도 저장하지 않는다 — 검증기(ETag)는
  // "저장된 걸 재검증할 때" 쓸모가 있는데 저장 자체가 없으니 ETag 를 남겨두면
  // 재검증이 실제로 도는지 아닌지만 헷갈리게 한다. Express 기본 ETag 를 끈다.
  app.getHttpAdapter().getInstance().set('etag', false);

  // 프론트는 별도 레포(quiz-app-web)의 별도 도메인이라 CORS 가 없으면 배포
  // 첫날 브라우저 호출이 전부 막힌다. X-Participant-Token 이 커스텀 헤더라
  // preflight 도 통과해야 한다. CORS_ORIGINS 가 없으면(로컬 등) 전체 허용한다.
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) ?? true,
    allowedHeaders: ['Content-Type', PARTICIPANT_TOKEN_HEADER],
  });

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
