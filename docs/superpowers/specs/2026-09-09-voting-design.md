# 투표 기능 설계

**대상 레포:** `jihxn-kim/quiz-app` (백엔드) + `jihxn-kim/quiz-app-web` (프론트)
**선행 스펙:** `2026-09-08-game-api-design.md`, `2026-09-09-web-frontend-design.md`

## 무엇을 만드는가

전원이 답변을 제출해 답이 공개된 뒤, 참가자들이 **제일 마음에 드는 답 하나에 투표**한다. 전원이 투표하면 득표 수가 공개된다.

그리고 답변 작성 중에도 화면이 덜 심심하도록, **제출한 사람의 답이 블러 처리된 채로 보인다** — 누가 뭔가를 썼다는 것은 보이지만 내용은 읽을 수 없다.

## 라운드 흐름

```
작성 중        내 답은 안 보임(아직 안 씀), 남의 답은 블러 블록
내가 제출함    내 답은 그대로 보임, 남의 답은 여전히 블러
전원 제출      → 공개 (기존 동작 그대로, revealedAt 기준 동기화 연출)
투표           1인 1표, 자기 답에도 투표 가능
전원 투표      → 결과 (votingClosedAt 기준 동기화, 득표 수만)
```

`skipped` 라운드에는 투표가 없다. 공개된 적이 없으므로 고를 답이 없다.

## 지키는 것

이 앱의 기존 불변식은 그대로다: **공개 전까지 남의 답변 텍스트는 어떤 경로로도 클라이언트에 도달하지 않는다.** 아래 두 결정이 그것을 지킨다.

### 블러는 가짜여야 한다

CSS `filter: blur()` 로 실제 텍스트를 가리는 구현은 **금지한다.** 그렇게 하면 텍스트가 DOM 에 존재하고, 개발자도구·요소 검사·`document.body.innerText` 한 줄로 읽힌다. 친구 중 한 명만 눈치채면 게임이 끝난다.

대신 서버는 **길이만** 보낸다. `RoundOpen.participants[]` 의 각 항목에 `answerLength: number | null` 을 추가한다(미제출이면 `null`). 프론트는 그 길이만큼 가짜 블록을 그린다. 화면상 결과는 같고, 읽을 텍스트가 애초에 존재하지 않는다.

길이 자체도 미세한 정보다(누가 길게 썼는지 알 수 있다). 모든 블록을 같은 크기로 그리면 그것도 막을 수 있으나, 화면이 죽어 보인다. **길이는 보내되 텍스트는 절대 보내지 않는다**를 택한다.

### 투표 중에는 득표 수를 보내지 않는다

`answers[].voteCount` 는 **투표가 닫히기 전까지 `null`** 이다.

실시간 집계가 보이면 앞서는 답에 표가 쏠린다. 남 눈치 보지 않고 고르는 것이 이 게임의 전부인데 그게 깨진다. 답변을 공개 전에 감추는 것과 같은 이유이고, 같은 방식(서버가 아예 안 보냄)으로 막는다.

## 데이터

```sql
CREATE TABLE votes (
  id                    bigserial PRIMARY KEY,
  round_id              bigint NOT NULL REFERENCES rounds(id),
  voter_participant_id  bigint NOT NULL REFERENCES participants(id),
  answer_id             bigint NOT NULL REFERENCES answers(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, voter_participant_id)
);
CREATE INDEX idx_votes_round ON votes (round_id);

ALTER TABLE rounds ADD COLUMN voting_closed_at timestamptz NULL;
```

`UNIQUE (round_id, voter_participant_id)` 가 1인 1표를 DB 레벨에서 강제한다. 애플리케이션 검사만으로는 동시 요청에서 두 표가 들어갈 수 있다.

기존 게임 엔티티와 마찬가지로 **TypeORM 관계 데코레이터를 쓰지 않는다.**

### 라운드 상태를 늘리지 않는 이유

`RoundStatus` 에 `voting` 을 추가하지 않는다. 라운드는 `revealed` 인 채로 투표 단계를 거친다.

새 상태를 추가하면 enum, 마이그레이션, 폴링 규칙(`pollTarget`), 응답 DTO 유니온, 컨트롤러 분기, 서비스 가드를 전부 손봐야 한다. 그 코드는 전부 리뷰를 거쳐 안정된 상태이고, 특히 폴링 규칙은 한 번 교착 버그가 났다가 고쳐진 곳이다. 상태 하나를 위해 그것을 다시 흔들 이유가 없다.

투표 완료 여부는 `votes` 개수와 참가자 수로 판단하고, 완료 시각은 `voting_closed_at` 이 기록한다.

## API

기존 엔드포인트는 그대로다. 아래가 추가·변경된다.

```jsonc
// POST /rounds/:id/votes     201
// 요청
{ "answerId": "77" }
// 응답
{ "voted": true, "allVoted": false }   // true 면 이 표로 투표가 닫혔다

// POST /rounds/:id/votes/close   200   방장만
// 아직 안 낸 사람이 있어도 투표를 닫는다. 응답은 갱신된 라운드.
```

`GET /rounds/:id` 의 `revealed` 응답에 다음이 추가된다:

```jsonc
{
  "roundId": "11",
  "status": "revealed",
  "question": { "id": "42", "text": "..." },
  "revealedAt": "2026-09-09T12:34:56.000Z",
  "revealedBy": null,
  "answers": [
    {
      "participantId": "1",
      "nickname": "지훈",
      "text": "촉감으로 확인할 것 같아",
      "answerId": "77",        // 추가: 투표 대상 식별자
      "voteCount": null        // 추가: 투표가 닫히기 전엔 null
    }
  ],
  "notSubmitted": [],
  "myVote": { "answerId": "77" },   // 추가: 아직 안 냈으면 null
  "votedCount": 2,                  // 추가: 몇 명이 투표했는지 (누구인지는 안 옴)
  "votingClosedAt": null            // 추가: 닫히면 ISO 시각
}
```

`RoundOpen` 응답의 변경:

```jsonc
"participants": [
  { "id": "2", "nickname": "민수", "submitted": true, "answerLength": 23 },
  { "id": "3", "nickname": "영희", "submitted": false, "answerLength": null }
]
```

### 오류

| 상태 | 언제 |
|---|---|
| 409 | 공개되지 않은 라운드에 투표 |
| 409 | 이미 투표함 (수정 불가) |
| 409 | 이미 닫힌 투표에 투표 |
| 403 | 이 방 참가자가 아님 |
| 404 | 그 라운드에 없는 `answerId` |

메시지는 한국어로, 기존 서비스 메시지와 같은 어조로 쓴다.

## 동시성

답변 제출과 같은 방식을 따른다. `submit()` 이 라운드 행에 `pessimistic_write` 잠금을 걸고 트랜잭션 안에서 처리하는 패턴이 이미 있고, 투표도 같은 구조가 필요하다:

- 잠금 안에서 라운드 상태와 `voting_closed_at` 을 확인한다 — 닫힌 뒤 들어온 표를 막는다
- 중복 투표를 확인하고 insert 한다. 유니크 위반(`23505`)은 409 로 변환한다
- 표를 넣은 뒤 개수를 세고, 전원이 투표했으면 `voting_closed_at` 을 찍는다

**통계 기록이 있다면 트랜잭션이 커밋된 뒤에 한다.** 트랜잭션 안에서 다른 커넥션으로 읽으면 방금 넣은 표가 보이지 않는다. 답변 제출에서 이미 겪은 문제다.

## 결과 공개 연출

`votingClosedAt` 을 기준점으로 득표 수가 카드에 순차적으로 붙는다. **기존 `revealTimings(revealedAt, now, count)` 를 그대로 재사용한다** — 이미 만들어져 있고, 폴링 시점이 달라도 모든 폰에서 같은 벽시계 시각에 열리는 성질이 검증되어 있다. 새로 만들 것이 없다.

카드 순서는 답변 공개 때 정해진 셔플 순서를 유지한다. 결과에서 순서가 바뀌면 방금 읽은 것을 다시 찾아야 한다.

## 화면

공개 화면(`components/game/Reveal.tsx`)이 세 모습을 가진다.

| 상태 | 화면 |
|---|---|
| 투표 전 | 카드마다 투표 버튼. 하단에 "N명 중 M명 투표" |
| 내가 투표함 | 내가 고른 카드에 표시, 나머지는 대기. 방장에게 "그냥 결과 보기" |
| 투표 끝 | 득표 수가 순차적으로 붙음. 방장에게 "다음 질문" |

"다음 질문"은 **투표가 끝난 뒤에만** 나온다. 지금은 공개 직후 나오는데, 투표할 틈도 없이 넘어가면 안 된다.

작성 화면(`components/game/AnswerForm.tsx`, `Waiting.tsx`)에는 블러 블록이 추가된다. 제출한 사람의 자리에 길이만큼의 흐린 블록이 놓이고, 미제출자는 빈 자리로 남는다.

## 테스트

| 대상 | 이유 |
|---|---|
| `open` 응답에 답변 텍스트가 없음 | 블러가 가짜인지 지키는 회귀선. 길이만 있고 텍스트가 없어야 한다 |
| 투표 전 `voteCount` 가 `null` | 실시간 집계 유출 방지 |
| 1인 1표 | 두 번째 투표가 409. 동시 요청에서도 유니크 제약이 잡는지 |
| 공개 전 라운드에 투표 | 409 |
| 전원 투표 시 `voting_closed_at` 기록 | 마지막 표가 닫는지 |
| 강제 종료 | 방장만, 미투표자가 있어도 닫힘 |
| 결과 순서 = 답변 순서 | 셔플 순서 유지 |

프론트는 블러 컴포넌트가 **텍스트를 받지 않는다는 것**을 타입으로 강제한다. `RoundOpen` 의 참가자 항목에 텍스트 필드가 없으므로, 답변 공개 전 상태에서 텍스트를 렌더하려는 코드는 컴파일되지 않는다 — 기존 DTO 분리와 같은 방어선이다.

## 미결 / 이후

- **투표는 질문 품질 신호가 될 수 있다.** 표가 한 답에 몰리는 질문과 고르게 갈리는 질문은 다르다. `question_stats` 에서 `answer_variance` 를 뺀 뒤 승격·은퇴 판정이 완주율과 스킵률만 쓰고 있는데, 투표 분포가 그 자리를 메울 수 있다. 이번 범위에는 넣지 않는다.
- 투표 수정 허용 여부 — 지금은 불가. 답변 제출과 같은 규칙이다.
- 참가자 탈퇴·강퇴 흐름이 생기면, 투표 분모도 답변 분모와 같은 문제를 겪는다(사람이 빠지면 분모가 줄어 조기 종료). 그때 두 곳을 같이 고쳐야 한다.
