import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from 'src/app.module';
import { PARTICIPANT_TOKEN_HEADER } from 'src/modules/game/auth/participant.guard';
import { QuestionStatsService } from 'src/modules/stats/question-stats.service';

jest.setTimeout(60_000);

describe('게임 전체 흐름 (실제 DB)', () => {
  let app: INestApplication;
  let hostToken: string;
  let guestToken: string;
  let code: string;
  let roundId: string;
  let otherCode: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // 이 스펙은 게임 흐름만 검증한다. QuestionStatsService 를 그대로 두면
      // 실제 골든 질문의 served/분산도 통계가 오염되고(더미 텍스트가 첫
      // 표본으로 누적 평균에 박힌다) 실행마다 OpenAI 임베딩 비용도 든다.
      .overrideProvider(QuestionStatsService)
      .useValue({
        recordServed: async () => {},
        recordSkipped: async () => {},
        recordAnswers: async () => {},
      })
      .compile();
    app = moduleRef.createNestApplication();
    // main.ts 의 프로덕션 파이프와 동일하게 맞춘다 — forbidNonWhitelisted
    // 가 빠지면 이 스펙은 프로덕션 파이프가 실제로 검증하는 걸 검증하지
    // 못한다.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    // 이 테스트는 실제 DB(questions 는 실운영 문제 은행)를 쓴다. 여기서 만든
    // 방/참가자/라운드/답변만 code 로 찾아 지운다 — questions·question_stats·
    // seed_axes·seed_combinations·generation_batches 는 절대 건드리지 않는다.
    const dataSource = app.get(DataSource);
    const codes = [code, otherCode].filter((value): value is string => Boolean(value));

    if (codes.length > 0) {
      const rooms: Array<{ id: string }> = await dataSource.query(
        'SELECT id FROM rooms WHERE code = ANY($1::varchar[])',
        [codes],
      );
      const roomIds = rooms.map((r) => r.id);

      if (roomIds.length > 0) {
        // rooms.host_participant_id ↔ participants.room_id, rounds.revealed_by ↔
        // participants.id 가 순환 참조라서, 참가자를 지우기 전에 두 참조를 먼저
        // NULL 로 끊어야 한다.
        await dataSource.query(
          'UPDATE rounds SET revealed_by = NULL WHERE room_id = ANY($1::bigint[])',
          [roomIds],
        );
        await dataSource.query(
          'UPDATE rooms SET host_participant_id = NULL WHERE id = ANY($1::bigint[])',
          [roomIds],
        );
        await dataSource.query(
          'DELETE FROM answers WHERE round_id IN (SELECT id FROM rounds WHERE room_id = ANY($1::bigint[]))',
          [roomIds],
        );
        await dataSource.query('DELETE FROM rounds WHERE room_id = ANY($1::bigint[])', [roomIds]);
        await dataSource.query(
          'DELETE FROM participants WHERE room_id = ANY($1::bigint[])',
          [roomIds],
        );
        await dataSource.query('DELETE FROM rooms WHERE id = ANY($1::bigint[])', [roomIds]);
      }
    }

    await app.close();
  });

  it('방을 만들고 참가한다', async () => {
    const created = await request(app.getHttpServer())
      .post('/rooms')
      .send({ nickname: '지훈' })
      .expect(201);
    code = created.body.code;
    hostToken = created.body.participantToken;
    expect(created.body.isHost).toBe(true);

    const joined = await request(app.getHttpServer())
      .post(`/rooms/${code}/participants`)
      .send({ nickname: '민수' })
      .expect(201);
    guestToken = joined.body.participantToken;
    expect(joined.body.isHost).toBe(false);
  });

  it('중복 닉네임은 409', async () => {
    await request(app.getHttpServer())
      .post(`/rooms/${code}/participants`)
      .send({ nickname: '민수' })
      .expect(409);
  });

  it('방장만 라운드를 시작할 수 있다', async () => {
    await request(app.getHttpServer())
      .post(`/rooms/${code}/rounds`)
      .set('X-Participant-Token', guestToken)
      .expect(403);

    const started = await request(app.getHttpServer())
      .post(`/rooms/${code}/rounds`)
      .set('X-Participant-Token', hostToken)
      .expect(201);
    roundId = started.body.roundId;
    expect(started.body.question.text).toBeTruthy();
  });

  it('공개 전에는 남의 답변이 응답에 없다', async () => {
    await request(app.getHttpServer())
      .post(`/rounds/${roundId}/answers`)
      .set('X-Participant-Token', guestToken)
      .send({ text: '민수의 비밀 답변' })
      .expect(201);

    const seen = await request(app.getHttpServer())
      .get(`/rounds/${roundId}`)
      .set('X-Participant-Token', hostToken)
      .expect(200);

    expect(seen.body.status).toBe('open');
    expect(JSON.stringify(seen.body)).not.toContain('민수의 비밀 답변');
    expect(seen.body.mySubmission).toBeNull();
  });

  it('마지막 한 명이 내면 자동 공개되고 모든 답이 보인다', async () => {
    const submitted = await request(app.getHttpServer())
      .post(`/rounds/${roundId}/answers`)
      .set('X-Participant-Token', hostToken)
      .send({ text: '지훈의 답변' })
      .expect(201);
    expect(submitted.body.allSubmitted).toBe(true);

    const revealed = await request(app.getHttpServer())
      .get(`/rounds/${roundId}`)
      .set('X-Participant-Token', hostToken)
      .expect(200);

    expect(revealed.body.status).toBe('revealed');
    const texts = revealed.body.answers.map((a: { text: string }) => a.text);
    expect(texts).toEqual(expect.arrayContaining(['민수의 비밀 답변', '지훈의 답변']));
  });

  it('중복 제출은 409', async () => {
    await request(app.getHttpServer())
      .post(`/rounds/${roundId}/answers`)
      .set('X-Participant-Token', hostToken)
      .send({ text: '또 냄' })
      .expect(409);
  });

  it('토큰 없이는 401', async () => {
    await request(app.getHttpServer()).get(`/rounds/${roundId}`).expect(401);
  });

  it('다른 방 참가자는 남의 방 라운드를 조회할 수 없다 (403)', async () => {
    // 이 방(B)의 참가자가 다른 방(A, code/roundId)의 라운드를 건드릴 수 없어야
    // 한다. 수정 전에는 유효한 참가자 토큰이면 어느 방 라운드든 조회돼 다른
    // 방의 공개된 답변 전문이 그대로 새 나갔다 — 이 파일에서 가장 중요한 케이스다.
    const otherRoom = await request(app.getHttpServer())
      .post('/rooms')
      .send({ nickname: '다른방장' })
      .expect(201);
    otherCode = otherRoom.body.code;
    const otherToken = otherRoom.body.participantToken;

    const leaked = await request(app.getHttpServer())
      .get(`/rounds/${roundId}`)
      .set(PARTICIPANT_TOKEN_HEADER, otherToken)
      .expect(403);
    expect(JSON.stringify(leaked.body)).not.toContain('지훈의 답변');
  });

  it('강제 공개는 201 이 아니라 200 을 반환한다', async () => {
    // reveal 은 리소스 생성이 아니라 상태 전이라 컨트롤러에
    // @HttpCode(HttpStatus.OK) 가 붙어 있다. 단위 테스트는 컨트롤러 메서드를
    // 직접 호출해 상태 코드를 보지 못하므로, 실제 HTTP 를 타는 이 테스트만
    // 회귀를 잡을 수 있다.
    const started = await request(app.getHttpServer())
      .post(`/rooms/${code}/rounds`)
      .set(PARTICIPANT_TOKEN_HEADER, hostToken)
      .expect(201);
    const newRoundId = started.body.roundId;

    await request(app.getHttpServer())
      .post(`/rounds/${newRoundId}/reveal`)
      .set(PARTICIPANT_TOKEN_HEADER, hostToken)
      .expect(200);
  });

  it('C1: 한 명만 제출한 라운드를 스킵하면 응답 어디에도 답변 텍스트가 없다', async () => {
    // 실 DB로 재현됐던 버그: 2명 중 1명만 제출한 상태에서 방장이 스킵하면
    // 아무것도 안 낸 사람에게도 제출된 답변 전문이 그대로 보였다. revealedAt
    // 은 null 인데도 — 공개된 적이 없는데 공개된 것처럼 답변이 샜다.
    const started = await request(app.getHttpServer())
      .post(`/rooms/${code}/rounds`)
      .set(PARTICIPANT_TOKEN_HEADER, hostToken)
      .expect(201);
    const skippedRoundId = started.body.roundId;

    await request(app.getHttpServer())
      .post(`/rounds/${skippedRoundId}/answers`)
      .set(PARTICIPANT_TOKEN_HEADER, guestToken)
      .send({ text: '민수의 민감한 답변' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/rounds/${skippedRoundId}/skip`)
      .set(PARTICIPANT_TOKEN_HEADER, hostToken)
      .expect(200);

    // 방장은 이 라운드에 아무것도 제출하지 않았다 — 브리핑의 "세 번째
    // 사람"에 해당한다.
    const seen = await request(app.getHttpServer())
      .get(`/rounds/${skippedRoundId}`)
      .set(PARTICIPANT_TOKEN_HEADER, hostToken)
      .expect(200);

    expect(seen.body.status).toBe('skipped');
    expect(seen.body.revealedAt).toBeUndefined();
    expect(seen.body.answers).toBeUndefined();
    expect(JSON.stringify(seen.body)).not.toContain('민수의 민감한 답변');
  });
});
