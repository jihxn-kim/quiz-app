# 게임 API 설계

- 작성일: 2026-09-08
- 대상: 방 생성·참가·답변 제출·공개까지의 게임 진행 API, 그리고 질문 통계 연결

## 1. 배경과 목표

### 게임

초대된 친구들끼리 하나의 질문에 각자 답을 적고, **전원이 제출을 완료했을 때에만** 서로의 답을 볼 수 있다. 정답을 맞히는 게임이 아니라, 서로 얼마나 다르게 생각하는지 확인하는 게임이다.

### 이 API 가 해결할 것

질문 생성 파이프라인(`2026-09-08-question-generation-design.md`)은 질문을 만들어 풀에 쌓는 데까지 완성됐다. 그 질문을 실제로 사람들에게 내보내고 답을 받는 부분이 없다.

동시에, 파이프라인의 **피드백 루프 절반이 발화 불가 상태**다. 골든 승격과 은퇴는 `question_stats.served` 가 30 이상이어야 도는데 그 값을 증가시키는 코드가 어디에도 없다. 게임 API 가 그 자리를 채운다.

### 확정된 전제

| 항목 | 결정 |
|---|---|
| 사용자 식별 | 익명. 링크 + 닉네임. 계정 없음 |
| 방 수명 | 방 하나 = 세션. 질문 여러 개를 이어서 진행 |
| 교착 처리 | 방장이 강제 공개 가능 |

## 2. 이 설계를 지배하는 불변식

**공개 전까지 남의 답변은 어떤 경로로도 새어나가지 않는다.**

이 게임의 재미는 전적으로 "동시에 까본다"에서 나온다. 한 번이라도 새면 그 방은 끝이고, 재미가 아니라 신뢰의 문제가 된다.

구현상 이 불변식은 **응답 DTO 를 두 개로 분리**해서 강제한다. 공개 전 응답 타입에는 답변 텍스트 필드가 아예 존재하지 않는다. 조건부로 필드를 비우는 방식은 쓰지 않는다 — 그러면 언젠가 누군가 조건을 잘못 건드린다.

```
공개 전 (RoundOpenDto)      participants[].submitted 만. text 필드 없음
공개 후 (RoundRevealedDto)  answers[].text 포함
```

## 3. 상태 기계

```
방(room)
  waiting ──(첫 라운드 시작)──> playing

라운드(round)
  open ──(전원 제출 | 방장 강제 공개)──> revealed
  open ──(방장 스킵)──────────────────> skipped
```

라운드는 한 방에 여러 개가 순서대로 생긴다. 이전 라운드가 `open` 인 동안 새 라운드를 시작할 수 없다.

**전원 제출 시 자동 공개는 답변 제출 핸들러 안에서 처리한다.** 제출 직후 미제출자 수가 0 이면 같은 트랜잭션에서 `revealed` 로 전이한다. 별도 스케줄러나 폴링 워커가 필요 없다.

## 4. 데이터 모델

```sql
CREATE TABLE rooms (
  id                  BIGSERIAL PRIMARY KEY,
  code                VARCHAR(8) NOT NULL UNIQUE,   -- 공유용 짧은 코드
  host_participant_id BIGINT,                       -- 참가자 생성 후 채움
  status              VARCHAR(16) NOT NULL DEFAULT 'waiting',
                      -- waiting | playing
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE participants (
  id         BIGSERIAL PRIMARY KEY,
  room_id    BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname   VARCHAR(20) NOT NULL,
  token      VARCHAR(64) NOT NULL UNIQUE,  -- 클라이언트가 보관. 이게 곧 신분
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, nickname)
);

ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_host
  FOREIGN KEY (host_participant_id) REFERENCES participants(id);

CREATE TABLE rounds (
  id           BIGSERIAL PRIMARY KEY,
  room_id      BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  question_id  BIGINT NOT NULL REFERENCES questions(id),
  sequence     INT NOT NULL,                 -- 방 안에서 몇 번째 라운드인가
  status       VARCHAR(16) NOT NULL DEFAULT 'open',
               -- open | revealed | skipped
  revealed_at  TIMESTAMPTZ,
  revealed_by  BIGINT REFERENCES participants(id),  -- 강제 공개한 사람. 자동 공개면 NULL
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, sequence),
  UNIQUE (room_id, question_id)              -- 한 방에서 같은 질문이 두 번 나오지 않는다
);

CREATE TABLE answers (
  id             BIGSERIAL PRIMARY KEY,
  round_id       BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  text           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, participant_id)          -- 한 사람 한 라운드 한 답변
);

CREATE INDEX ON rounds (room_id, status);
CREATE INDEX ON answers (round_id);
```

**순환 참조 주의.** `rooms.host_participant_id` 는 `participants` 를, `participants.room_id` 는 `rooms` 를 참조한다. 방 생성은 반드시 한 트랜잭션 안에서 세 단계로 한다 — ① `host_participant_id` 를 NULL 로 두고 방 삽입, ② 그 방의 참가자 삽입, ③ 방의 `host_participant_id` 갱신. 이 순서를 어기면 FK 위반이 난다.

`participants.token` 이 유일한 신분 근거다. 계정이 없으므로 토큰을 가진 사람은 그 참가자로 행동할 수 있다. 친구끼리 하는 게임이라 수용한다.

`rounds` 의 `UNIQUE (room_id, question_id)` 가 한 방에서 같은 질문이 반복되는 것을 DB 레벨에서 막는다. 애플리케이션 필터에만 의존하지 않는다.

## 5. 엔드포인트

인증은 `X-Participant-Token` 헤더로 한다. 방 생성과 참가를 제외한 모든 요청에 필요하다.

### POST /rooms — 방 생성

만든 사람이 곧 방장이자 첫 참가자가 된다.

```jsonc
// 요청
{ "nickname": "지훈" }

// 응답 201
{
  "code": "K3P9XM",              // 공유용 코드. 링크는 프론트가 조립
  "participantToken": "8f3a...", // 클라이언트가 보관. 이후 모든 요청에 사용
  "participantId": "1",
  "isHost": true
}
```

### POST /rooms/:code/participants — 참가

```jsonc
// 요청
{ "nickname": "민수" }

// 응답 201
{ "participantToken": "b71c...", "participantId": "2", "isHost": false }

// 409 — 같은 방에 같은 닉네임이 이미 있음
// 404 — 코드에 해당하는 방 없음
```

### GET /rooms/:code — 방 상태

```jsonc
{
  "code": "K3P9XM",
  "status": "playing",
  "isHost": true,                       // 요청자 기준
  "participants": [
    { "id": "1", "nickname": "지훈", "isHost": true },
    { "id": "2", "nickname": "민수", "isHost": false }
  ],
  "currentRound": { "id": "10", "sequence": 3, "status": "open" }  // 없으면 null
}
```

### POST /rooms/:code/rounds — 다음 질문 시작 (방장)

풀에서 질문 하나를 뽑아 라운드를 연다. 동시에 그 질문의 `served` 를 1 증가시킨다.

```jsonc
// 요청 본문 없음
// 응답 201
{
  "roundId": "11",
  "sequence": 4,
  "question": { "id": "42", "text": "시각장애인은 변 닦고 다 닦였는지 어떻게 확인할까?" }
}

// 403 — 방장이 아님
// 409 — 이전 라운드가 아직 open
// 409 — 이 방에서 낼 수 있는 질문이 더 이상 없음
```

### GET /rounds/:id — 라운드 상태

**2번 불변식이 적용되는 지점.** 상태에 따라 응답 모양이 다르다.

```jsonc
// status = open — 텍스트 필드가 존재하지 않는다
{
  "roundId": "11",
  "status": "open",
  "question": { "id": "42", "text": "..." },
  "participants": [
    { "id": "1", "nickname": "지훈", "submitted": true },
    { "id": "2", "nickname": "민수", "submitted": false }
  ],
  "mySubmission": { "text": "촉감으로 확인할 것 같아" }  // 본인 답변만. 미제출이면 null
}

// status = revealed
{
  "roundId": "11",
  "status": "revealed",
  "question": { "id": "42", "text": "..." },
  "revealedAt": "2026-09-08T12:34:56.000Z",
  "revealedBy": { "id": "1", "nickname": "지훈" },   // 자동 공개면 null
  "answers": [
    { "participantId": "1", "nickname": "지훈", "text": "촉감으로 확인할 것 같아" },
    { "participantId": "2", "nickname": "민수", "text": "물티슈 색을 손으로..." }
  ],
  "notSubmitted": [ ]   // 강제 공개 시 미제출자 목록
}
```

본인 답변(`mySubmission`)은 공개 전에도 돌려준다. 자기가 뭘 썼는지는 볼 수 있어야 한다.

### POST /rounds/:id/answers — 답변 제출

```jsonc
// 요청
{ "text": "촉감으로 확인할 것 같아" }

// 응답 201
{ "submitted": true, "allSubmitted": false }
// allSubmitted 가 true 면 이 요청으로 라운드가 revealed 로 전이됐다는 뜻

// 409 — 이미 제출함 (수정 불가)
// 409 — 라운드가 open 이 아님
// 400 — text 가 비었거나 500자 초과
```

제출은 수정 불가다. 남의 답을 보고 고치는 것을 막는 게 아니라(공개 전엔 못 본다), 제출 시점의 생각을 그대로 남기기 위해서다.

### POST /rounds/:id/reveal — 강제 공개 (방장)

```jsonc
// 응답 200 — GET /rounds/:id 의 revealed 응답과 동일한 모양
// 403 — 방장이 아님
// 409 — 이미 revealed
```

### POST /rounds/:id/skip — 질문 스킵 (방장)

답이 안 나오거나 분위기에 안 맞는 질문을 넘긴다. 그 질문의 `skipped` 를 1 증가시킨다.

```jsonc
// 응답 200
{ "roundId": "11", "status": "skipped" }
// 403 — 방장이 아님
// 409 — 이미 revealed
```

## 6. 질문 생성 파이프라인과의 연결

지금 `question_stats.served` 와 `skipped` 를 증가시키는 코드가 **어디에도 없다.** 그래서 `promoteGolden` 과 `retireUnderperformers` 는 `served >= 30` 조건 때문에 영구 미발화 상태다. 이 API 가 그 자리를 채워 루프를 닫는다.

| 시점 | 호출 |
|---|---|
| 라운드 시작 (`POST /rooms/:code/rounds`) | `QuestionStatsService.recordServed(questionId)` |
| 스킵 (`POST /rounds/:id/skip`) | `QuestionStatsService.recordSkipped(questionId)` |
| 공개 완료 (자동/강제 무관) | `QuestionStatsService.recordAnswers(questionId, texts)` |

`recordServed` 와 `recordSkipped` 는 신규다. `recordAnswers` 는 이미 있고 누적 평균으로 동작한다.

**강제 공개 시에도 `recordAnswers` 를 호출한다.** 제출된 답변만 넘긴다. 답변이 1개 이하면 `meanPairwiseDistance` 가 0 을 돌려주는데, 이는 "분산 없음"이 아니라 "측정 불가"에 가깝다. 그래서 **답변이 2개 미만인 라운드는 `recordAnswers` 를 호출하지 않는다** — 측정 불가를 0 으로 기록하면 그 질문이 부당하게 은퇴 후보가 된다.

## 7. 질문 선택

`status = 'live'` 이면서 이 방에서 아직 나오지 않은 질문 중 무작위 하나.

```sql
SELECT q.id, q.text FROM questions q
WHERE q.status = 'live'
  AND q.id NOT IN (SELECT question_id FROM rounds WHERE room_id = $1)
ORDER BY random() LIMIT 1;
```

풀이 수백~수천 규모라 `ORDER BY random()` 로 충분하다. 수만 건이 되면 그때 바꾼다.

**선행 작업:** 현재 `live` 는 부트스트랩 골든 20개뿐이고, 파이프라인이 만든 17개는 `pending` 이다. 검수 후 `live` 로 올리는 경로가 CLI 에 없다 — `ReviewService.publish()` 는 구현돼 있으나 호출하는 곳이 없다. **`review --publish <ids>` 를 이 작업에 포함한다.** 없으면 검수를 해도 게임에 나오지 않는다.

## 8. 프론트가 상태를 아는 법

**폴링으로 시작한다.** 라운드가 열려 있는 동안 `GET /rounds/:id` 를 2초 간격으로 호출한다.

SSE 가 체감이 더 낫지만 재연결·하트비트·프록시 버퍼링 처리가 따라붙는다. 방 하나에 참가자 몇 명 규모에서 2초 폴링은 부하가 문제되지 않는다. 나중에 필요하면 **같은 응답 모양 그대로** SSE 를 얹으면 되므로 프론트 변경이 작다.

## 9. 에러 처리

| 상황 | 처리 |
|---|---|
| 토큰 없음/잘못됨 | 401 |
| 토큰은 유효하나 그 방의 참가자가 아님 | 403 |
| 방장 전용 동작을 비방장이 시도 | 403 |
| 존재하지 않는 방/라운드 | 404 |
| 상태 전이 위반 (이미 제출, 이미 공개, 이전 라운드 open) | 409 |
| 낼 수 있는 질문 소진 | 409, 메시지에 명시 |
| 닉네임 중복 | 409 |
| 통계 기록 실패 | 게임 흐름을 막지 않는다. 로그만 남기고 응답은 정상 처리 |

마지막 항목이 중요하다. 통계는 부가 기능이고, 그것 때문에 사람들이 하던 게임이 멈추면 안 된다.

## 10. 테스트 전략

| 대상 | 방법 |
|---|---|
| **공개 전 답변 미노출** | 최우선. 라운드가 `open` 인 동안 `GET /rounds/:id` 응답 어디에도 남의 답변 텍스트가 없음을 단언. 응답 전체를 문자열화해 다른 참가자의 답변이 포함되지 않는지 확인 |
| 전원 제출 자동 공개 | 마지막 한 명이 제출하는 순간 `revealed` 로 전이 |
| 강제 공개 | 미제출자가 있어도 공개되고 `notSubmitted` 에 잡힘 |
| 중복 제출 | 두 번째 제출이 409 |
| 방장 권한 | 비방장의 다음질문/공개/스킵이 403 |
| 라운드 순서 | 이전 라운드가 open 인데 새 라운드 시작 시 409 |
| 질문 중복 | 같은 방에서 같은 질문이 두 번 나오지 않음 (DB 제약 + 선택 쿼리) |
| 질문 소진 | 낼 질문이 없을 때 409 |
| 통계 연결 | 라운드 시작이 `served` 를, 스킵이 `skipped` 를, 공개가 `recordAnswers` 를 부르는지 |
| 답변 1개 라운드 | `recordAnswers` 를 부르지 않음 |
| 통계 실패 격리 | 통계 서비스가 던져도 게임 요청은 성공 |

첫 항목이 이 API 의 존재 이유를 지키는 테스트다. 나머지가 다 통과해도 이게 깨지면 제품이 죽는다.

## 11. 알면서 감수하는 것

**방장이 사라지면 방이 멈춘다.** 다음 질문·강제 공개·스킵이 전부 방장 권한이라, 방장 기기가 죽으면 그 방은 진행 불가다. 위임이나 시간 기반 폴백을 넣을 수 있지만 지금은 넣지 않는다 — 한자리에 모여서 하는 게임이고, 새 방을 만드는 비용이 링크 하나 다시 보내는 정도다. 실제로 문제가 되면 그때 "N분 경과 시 아무나 공개 가능"을 얹는다.

**토큰을 아는 사람은 그 참가자로 행동할 수 있다.** 계정이 없으므로 불가피하다. 판돈이 없는 게임이라 수용한다.

## 12. 범위 밖

- 프론트엔드 (별도 레포 `quiz-app-web`)
- 실시간 푸시 (SSE/WebSocket) — 폴링으로 시작
- 방 재입장·기록 조회·계정 연결
- 질문 생성 파이프라인 자체 (별도 스펙)
