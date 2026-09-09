# 웹 프론트엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방을 만들고 친구를 초대해 각자 답을 적고, 전원이 제출하면 모두가 같은 순간에 답을 보는 웹 클라이언트를 만든다.

**Architecture:** Next.js App Router 위의 순수 클라이언트 앱. 모든 호출이 localStorage 의 참가자 토큰을 필요로 하므로 서버 렌더링할 데이터가 없다. 서버 상태는 TanStack Query 로 2초 폴링하고, 공개 연출은 서버가 준 `revealedAt` 을 기준점으로 각 클라이언트가 계산해 폴링 시점이 달라도 모두 같은 벽시계 시각에 답을 본다.

**Tech Stack:** Next.js 16.3.4 · React 19.2.8 · Tailwind CSS 4 · TanStack Query 5 · motion 13 · Vitest 5 + Testing Library

**Spec:** `docs/superpowers/specs/2026-09-09-web-frontend-design.md`

## Global Constraints

**레포가 둘이다.** Task 1 은 백엔드(`~/Desktop/quiz-app`), Task 2 이후는 프론트엔드(`~/Desktop/quiz-app-web`)에서 작업한다. 각 태스크가 어느 레포인지 명시돼 있다.

**검증된 버전** (2026-09-09 실제 설치·빌드·테스트로 확인함):

```
node 24.12.0 / npm 11.6.2
next 16.3.4, react 19.2.8, react-dom 19.2.8
@tanstack/react-query ^5.102.8
motion ^13.2.0                     — import 는 'motion/react' 에서
tailwindcss ^4 + @tailwindcss/postcss   — CSS-first. tailwind.config.js 는 만들지 않는다
vitest ^5.0.0, @vitejs/plugin-react ^6.1.1, jsdom ^29.1.1
@testing-library/react ^16.3.3, @testing-library/jest-dom ^7.0.1
@types/node ^24
```

**두 가지 함정** (실제로 겪었다):
1. `create-next-app` 은 `@types/node@^20` 을 박는데 Vitest 5 는 `^22.0.0 || >=24.0.0` 을 요구한다. 그대로 두고 Vitest 를 설치하면 `ERESOLVE` 로 **설치가 실패한다.** Vitest 설치 전에 `@types/node@^24` 로 올릴 것.
2. `vitest.config.mts` 에서 `__dirname` 을 쓰면 Vite 가 경고를 낸다. `import.meta.dirname` 을 쓸 것.

**백엔드 API** — 모든 요청에 `X-Participant-Token` 헤더. 기본 URL 은 `NEXT_PUBLIC_API_BASE`.

| 메서드 | 경로 | 성공 | 비고 |
|---|---|---|---|
| POST | `/rooms` | 201 | `{ code, participantToken, participantId, isHost }` |
| POST | `/rooms/:code/participants` | 201 | `{ participantToken, participantId, isHost }` |
| GET | `/rooms/:code` | 200 | `{ code, status, isHost, participants[], currentRound|null }` |
| POST | `/rooms/:code/rounds` | 201 | 방장만. `{ roundId, sequence, question }` |
| GET | `/rounds/:id` | 200 | status 에 따라 open / revealed / skipped 세 모양 |
| POST | `/rounds/:id/answers` | 201 | `{ submitted, allSubmitted }` |
| POST | `/rounds/:id/reveal` | **200** | 방장만 |
| POST | `/rounds/:id/skip` | **200** | 방장만 |

reveal/skip 이 200 인 것에 주의 — 나머지 POST 는 201 이다.

**모든 사용자 노출 문구는 한국어.** 커밋 메시지도 한국어와 영어만, **한자 금지**. 커밋은 다음 두 트레일러로 끝낸다:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5
```

**푸시는 사용자의 명시적 승인 없이 하지 않는다.** 커밋까지 하고 보고한다.

**공개 전 남의 답변은 어떤 경로로도 화면에 닿지 않는다.** 백엔드가 `open` 상태 응답에 남의 답변을 아예 담지 않으므로 프론트에는 그럴 데이터가 없다. 그 성질을 깨는 코드(예: 공개 전에 답변을 미리 받아두는 캐시)를 만들지 않는다.

## 이 계획서의 상세도에 대해

`lib/` 태스크(3~6)는 **완전한 코드와 완전한 테스트**를 담고 있다. 이 앱의 correctness 는 거기 있다 — 공개 타이밍 계산이 틀리면 게임이 어긋나고, 세션 처리가 틀리면 재접속이 깨진다. 구현자는 그대로 옮겨 적으면 된다.

화면 태스크(7~11)는 **props 계약·동작 요구사항·호출할 API** 를 정하되 시각적 선택은 구현자에게 맡긴다. 이건 누락이 아니라 의도다. 사용자가 "제대로 만들자"를 골랐고, 마감 품질은 계획서에서 받아쓰는 것보다 구현자가 화면을 보면서 만드는 편이 낫다. 대신 **무엇이 참이어야 하는지**는 빠짐없이 적었다 — 어떤 상태에서 무엇이 보이고 무엇이 보이면 안 되는지, 어떤 버튼이 누구에게만 있는지.

리뷰어는 화면 태스크에서 "코드가 없다"를 결함으로 보지 말고, **동작 요구사항이 지켜졌는지**로 판단할 것.

---

## 파일 구조

**백엔드** (`~/Desktop/quiz-app`) — Task 1 에서만 건드린다.

| 파일 | 책임 |
|---|---|
| `package.json` | `start` 스크립트에 마이그레이션 실행 추가 |

**프론트엔드** (`~/Desktop/quiz-app-web`)

| 파일 | 책임 |
|---|---|
| `app/layout.tsx` | HTML 셸, 폰트, 전역 CSS |
| `app/providers.tsx` | QueryClientProvider (클라이언트 컴포넌트) |
| `app/page.tsx` | `/` 시작 화면 |
| `app/join/[code]/page.tsx` | 초대 링크 참가 화면 |
| `app/room/[code]/page.tsx` | 게임 화면. 상태에 따라 하위 컴포넌트를 고른다 |
| `lib/types.ts` | API 응답 타입 |
| `lib/api.ts` | fetch 래퍼, 에러 매핑 |
| `lib/session.ts` | localStorage 세션 |
| `lib/reveal.ts` | 공개 타이밍 계산 (순수 함수) |
| `lib/shuffle.ts` | roundId 시드 결정적 셔플 |
| `lib/polling.ts` | 상태별 폴링 대상 결정 |
| `components/game/Lobby.tsx` | 라운드 없음 |
| `components/game/AnswerForm.tsx` | open · 미제출 |
| `components/game/Waiting.tsx` | open · 제출함 |
| `components/game/Reveal.tsx` | revealed · 연출 |
| `components/game/Skipped.tsx` | skipped |
| `components/ui/*` | 버튼·입력·카드 등 공용 |

`lib/` 는 순수 로직이라 전부 단위 테스트를 붙인다. `components/` 는 유출 방지와 상태 분기만 테스트한다 — 시각적 마감은 테스트하지 않는다.

---

## Task 1: 백엔드 선행 조건

**레포:** `~/Desktop/quiz-app`

**Files:**
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: 운영 환경에서 동작하는 게임 API. 이후 모든 태스크가 여기에 의존한다.

**왜 필요한가:** 현재 배포된 백엔드는 `POST /rooms` 에 500 을 반환한다. Railway 로그의 Postgres 오류는 `42P01`(테이블 없음)이다. `start` 스크립트가 `npm run build && node dist/main` 뿐이라 마이그레이션이 한 번도 실행되지 않았다. 이걸 고치지 않으면 프론트는 첫 화면에서 죽는다.

- [ ] **Step 1: 현재 상태 확인**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://quiz-app-production-6e37.up.railway.app/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://quiz-app-production-6e37.up.railway.app/rooms \
  -H "Content-Type: application/json" -d '{"nickname":"확인"}'
```

Expected: health 는 `200`, rooms 는 `500`. 이게 고칠 대상이다.

- [ ] **Step 2: start 스크립트에 마이그레이션 추가**

`package.json` 의 `start` 를 바꾼다:

```json
"start": "npm run build && npm run typeorm -- migration:run && node dist/main"
```

`typeorm` 스크립트는 이미 있다: `"typeorm": "typeorm-ts-node-commonjs -d src/infrastructure/database/data-source.ts"`.

마이그레이션이 실패하면 `&&` 때문에 앱이 뜨지 않는다. 이게 맞는 동작이다 — 스키마가 어긋난 채로 서비스되는 것보다 안 뜨는 게 낫다.

- [ ] **Step 3: 커밋**

```bash
git add package.json
git commit -m "fix: 배포 시 마이그레이션이 실행되도록 start 스크립트 수정

운영 DB 에 테이블이 없어 게임 API 가 전부 500 을 반환하고 있었다.
마이그레이션 실패 시 앱이 뜨지 않는 것은 의도한 동작이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

- [ ] **Step 4: 배포 확인**

사용자 승인 후 푸시하면 Railway 가 자동 배포한다. 배포 완료 후:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://quiz-app-production-6e37.up.railway.app/rooms \
  -H "Content-Type: application/json" -d '{"nickname":"확인"}'
```

Expected: `201`

응답 본문의 `code` 로 만들어진 방을 확인하고, 확인용으로 만든 방은 그대로 둔다(정리 경로가 없고 무해하다).

**주의:** `CORS_ORIGINS` 환경변수 설정은 Task 12 에서 한다. Vercel 도메인이 그때 정해지기 때문이다. 지금은 미설정 상태이고, 미설정이면 `main.ts` 가 전체 허용으로 동작하므로 개발에 지장이 없다.

---

## Task 2: 프로젝트 스캐폴딩과 테스트 하네스

**레포:** `~/Desktop/quiz-app-web` (새로 만든다)

**Files:**
- Create: 프로젝트 전체
- Create: `vitest.config.mts`, `vitest.setup.ts`
- Create: `.env.local`, `.env.example`

**Interfaces:**
- Produces: `npm test` 로 도는 테스트 하네스, `npm run build` 로 도는 빌드. 이후 모든 태스크가 여기에 얹힌다.

- [ ] **Step 1: 레포 클론과 스캐폴딩**

```bash
cd ~/Desktop
gh repo clone jihxn-kim/quiz-app-web -- --origin origin
```

레포는 비어 있으므로 클론 후 디렉터리만 생긴다. 그 안에 스캐폴딩한다:

```bash
cd ~/Desktop
npx --yes create-next-app@16.3.4 quiz-app-web-tmp \
  --ts --tailwind --app --no-src-dir --eslint --turbopack \
  --import-alias "@/*" --use-npm --disable-git --yes
cp -R quiz-app-web-tmp/. quiz-app-web/
rm -rf quiz-app-web-tmp
cd quiz-app-web
```

`create-next-app` 이 `AGENTS.md` 와 `CLAUDE.md` 를 만든다. 둘 다 지운다 — 이 프로젝트의 규칙은 이 계획서와 스펙에 있다.

```bash
rm -f AGENTS.md CLAUDE.md
```

- [ ] **Step 2: 의존성 설치 — 순서가 중요하다**

```bash
npm i @tanstack/react-query motion
npm i -D @types/node@^24
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

**`@types/node@^24` 를 먼저 올리지 않으면 세 번째 줄이 `ERESOLVE` 로 실패한다.** `create-next-app` 이 박는 `^20` 과 Vitest 5 의 peer 요구(`^22.0.0 || >=24.0.0`)가 충돌한다.

- [ ] **Step 3: 테스트 설정**

`vitest.config.mts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: { alias: { '@': import.meta.dirname } },
});
```

`__dirname` 을 쓰면 Vite 가 경고를 낸다. `import.meta.dirname` 을 쓴다.

`vitest.setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

`package.json` 의 `scripts` 에 추가:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: 환경변수**

`.env.local`:

```
NEXT_PUBLIC_API_BASE=https://quiz-app-production-6e37.up.railway.app
```

`.env.example` 에 같은 키를 값 없이 적는다. `.gitignore` 에 `.env.local` 이 이미 있는지 확인하고, 없으면 추가한다.

- [ ] **Step 5: 하네스가 실제로 도는지 확인하는 테스트**

`lib/smoke.test.tsx` (JSX 가 있으므로 `.tsx` 여야 한다):

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello({ name }: { name: string }) {
  return <p>안녕 {name}</p>;
}

describe('테스트 하네스', () => {
  it('순수 함수를 테스트할 수 있다', () => {
    expect(1 + 1).toBe(2);
  });

  it('컴포넌트를 렌더하고 jest-dom 단언을 쓸 수 있다', () => {
    render(<Hello name="지훈" />);
    expect(screen.getByText('안녕 지훈')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 실행 확인**

```bash
npm test
```

Expected: 2 passed. 경고 없이 통과해야 한다.

```bash
npm run build
```

Expected: 빌드 성공.

- [ ] **Step 7: 스모크 테스트 제거 후 커밋**

하네스가 동작하는 것을 확인했으므로 스모크 테스트는 지운다 — 아무 동작도 지키지 않는 테스트를 남기지 않는다.

```bash
rm lib/smoke.test.tsx
git add -A
git commit -m "chore: Next.js 16 + Tailwind 4 + Vitest 스캐폴딩

@types/node 는 create-next-app 기본값 ^20 대신 ^24 로 올렸다.
Vitest 5 의 peer 요구와 충돌해 설치가 실패한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 3: API 타입과 클라이언트

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `lib/types.ts`
- Create: `lib/api.ts`
- Test: `lib/api.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; body: string }`
  - `apiFetch<T>(path: string, opts?: { method?: string; body?: unknown; token?: string }): Promise<T>`
  - 타입: `RoomState`, `RoundOpen`, `RoundRevealed`, `RoundSkipped`, `RoundState`, `CreateRoomResult`, `JoinRoomResult`, `StartRoundResult`, `SubmitAnswerResult`, `Participant`, `ParticipantSubmission`, `Question`, `RevealedAnswer`

- [ ] **Step 1: 타입 정의**

`lib/types.ts`:

```typescript
export interface Question {
  id: string;
  text: string;
}

export interface Participant {
  id: string;
  nickname: string;
  isHost: boolean;
}

export interface ParticipantSubmission {
  id: string;
  nickname: string;
  submitted: boolean;
}

export interface RevealedAnswer {
  participantId: string;
  nickname: string;
  text: string;
}

export interface CurrentRound {
  id: string;
  sequence: number;
  status: 'open' | 'revealed' | 'skipped';
}

export interface RoomState {
  code: string;
  status: 'waiting' | 'playing';
  isHost: boolean;
  participants: Participant[];
  currentRound: CurrentRound | null;
}

export interface RoundOpen {
  roundId: string;
  status: 'open';
  question: Question;
  participants: ParticipantSubmission[];
  mySubmission: { text: string } | null;
}

export interface RoundRevealed {
  roundId: string;
  status: 'revealed';
  question: Question;
  revealedAt: string | null;
  revealedBy: Participant | null;
  answers: RevealedAnswer[];
  notSubmitted: Participant[];
}

export interface RoundSkipped {
  roundId: string;
  status: 'skipped';
  question: Question;
}

export type RoundState = RoundOpen | RoundRevealed | RoundSkipped;

export interface CreateRoomResult {
  code: string;
  participantToken: string;
  participantId: string;
  isHost: boolean;
}

export interface JoinRoomResult {
  participantToken: string;
  participantId: string;
  isHost: boolean;
}

export interface StartRoundResult {
  roundId: string;
  sequence: number;
  question: Question;
}

export interface SubmitAnswerResult {
  submitted: boolean;
  allSubmitted: boolean;
}
```

`RoundState` 를 유니온으로 두는 것이 중요하다. `status` 로 좁히면 타입스크립트가 **`open` 상태에서 `answers` 에 접근하는 코드를 컴파일 단계에서 막는다.** 백엔드의 DTO 분리와 같은 방어선을 프론트에도 세우는 것이다.

- [ ] **Step 2: 실패하는 테스트 작성**

`lib/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError } from './api';

const originalFetch = global.fetch;

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'https://api.test');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('기본 URL 을 붙이고 JSON 을 파싱한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 'K3P9XM' }),
    }) as unknown as typeof fetch;

    const result = await apiFetch<{ code: string }>('/rooms/K3P9XM');

    expect(result).toEqual({ code: 'K3P9XM' });
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.test/rooms/K3P9XM');
  });

  it('토큰을 주면 X-Participant-Token 헤더에 넣는다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => '{}',
    }) as unknown as typeof fetch;

    await apiFetch('/rooms/K3P9XM', { token: 'tok123' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['X-Participant-Token']).toBe('tok123');
  });

  it('토큰이 없으면 헤더를 붙이지 않는다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => '{}',
    }) as unknown as typeof fetch;

    await apiFetch('/rooms');

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['X-Participant-Token']).toBeUndefined();
  });

  it('body 를 주면 JSON 으로 직렬화하고 Content-Type 을 붙인다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 201, text: async () => '{}',
    }) as unknown as typeof fetch;

    await apiFetch('/rooms', { method: 'POST', body: { nickname: '지훈' } });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"nickname":"지훈"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('실패하면 status 와 백엔드 메시지를 담은 ApiError 를 던진다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ message: '이미 사용 중인 닉네임입니다' }),
    }) as unknown as typeof fetch;

    await expect(apiFetch('/rooms/K3P9XM/participants')).rejects.toMatchObject({
      status: 409,
      message: '이미 사용 중인 닉네임입니다',
    });
  });

  it('에러 본문이 JSON 이 아니어도 죽지 않는다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 502, text: async () => '<html>Bad Gateway</html>',
    }) as unknown as typeof fetch;

    const error = await apiFetch('/rooms').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
  });

  it('네트워크 자체가 실패하면 status 0 인 ApiError 로 감싼다', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    const error = await apiFetch('/rooms').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it('204 처럼 본문이 없으면 undefined 를 돌려준다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 204, text: async () => '',
    }) as unknown as typeof fetch;

    await expect(apiFetch('/rounds/1/skip', { method: 'POST' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2b: 실패 확인**

```bash
npx vitest run lib/api
```

Expected: FAIL — `./api` 모듈이 없다.

- [ ] **Step 3: 구현**

`lib/api.ts`:

```typescript
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

/**
 * 백엔드 호출 한 곳. 실패는 전부 ApiError 로 통일한다.
 * status 0 은 네트워크 자체가 실패한 경우다(오프라인, DNS, CORS 차단).
 */
export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? '';
  const headers: Record<string, string> = {};
  if (opts.token) headers['X-Participant-Token'] = opts.token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (cause) {
    throw new ApiError(0, '서버에 연결할 수 없어요', String(cause));
  }

  const text = await response.text();

  if (!response.ok) {
    // 백엔드는 4xx 에 한국어 메시지를 담아준다. 그대로 쓰는 편이
    // 프론트에서 상황별 문구를 다시 만드는 것보다 정확하다.
    throw new ApiError(response.status, extractMessage(text, response.status), text);
  }

  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

function extractMessage(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
    if (Array.isArray(parsed.message) && typeof parsed.message[0] === 'string') {
      return parsed.message[0];
    }
  } catch {
    // JSON 이 아닌 에러 본문(프록시의 HTML 등)도 온다
  }
  return `요청이 실패했어요 (${status})`;
}
```

`extractMessage` 가 배열도 처리하는 이유: NestJS 의 `ValidationPipe` 는 `message` 를 문자열 배열로 준다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run lib/api
```

Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/types.ts lib/api.ts lib/api.test.ts
git commit -m "feat: API 타입과 fetch 클라이언트 추가

라운드 응답을 status 로 좁히는 유니온으로 정의해, 공개 전 상태에서
답변에 접근하는 코드가 컴파일되지 않게 했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 4: 세션 저장소

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `lib/session.ts`
- Test: `lib/session.test.ts`

**Interfaces:**
- Produces:
  - `interface Session { participantToken: string; participantId: string; nickname: string }`
  - `loadSession(roomCode: string): Session | null`
  - `saveSession(roomCode: string, session: Session): void`
  - `clearSession(roomCode: string): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadSession, saveSession, clearSession } from './session';

const session = { participantToken: 'tok', participantId: '2', nickname: '민수' };

describe('세션 저장소', () => {
  beforeEach(() => localStorage.clear());

  it('저장한 세션을 그대로 읽는다', () => {
    saveSession('K3P9XM', session);
    expect(loadSession('K3P9XM')).toEqual(session);
  });

  it('저장한 적 없는 방은 null', () => {
    expect(loadSession('NOROOM')).toBeNull();
  });

  it('방마다 따로 저장돼 서로 덮어쓰지 않는다', () => {
    saveSession('AAAAAA', session);
    saveSession('BBBBBB', { ...session, nickname: '영희' });

    expect(loadSession('AAAAAA')?.nickname).toBe('민수');
    expect(loadSession('BBBBBB')?.nickname).toBe('영희');
  });

  it('삭제하면 그 방만 지워진다', () => {
    saveSession('AAAAAA', session);
    saveSession('BBBBBB', session);

    clearSession('AAAAAA');

    expect(loadSession('AAAAAA')).toBeNull();
    expect(loadSession('BBBBBB')).not.toBeNull();
  });

  it('깨진 JSON 이 들어있으면 null 을 주고 그 키를 지운다', () => {
    localStorage.setItem('quiz-app:session:K3P9XM', '{이건 JSON 이 아님');

    expect(loadSession('K3P9XM')).toBeNull();
    expect(localStorage.getItem('quiz-app:session:K3P9XM')).toBeNull();
  });

  it('필드가 빠진 값이 들어있으면 null 로 취급한다', () => {
    localStorage.setItem('quiz-app:session:K3P9XM', JSON.stringify({ nickname: '민수' }));

    expect(loadSession('K3P9XM')).toBeNull();
  });

  it('저장소 접근이 막혀 있어도(시크릿 모드 등) 던지지 않는다', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });

    expect(loadSession('K3P9XM')).toBeNull();

    spy.mockRestore();
  });

  it('저장이 막혀 있어도 던지지 않는다', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });

    expect(() => saveSession('K3P9XM', session)).not.toThrow();

    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/session
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`lib/session.ts`:

```typescript
export interface Session {
  participantToken: string;
  participantId: string;
  nickname: string;
}

const keyFor = (roomCode: string) => `quiz-app:session:${roomCode}`;

/**
 * 방마다 키를 나눈다. 여러 방을 오가도 서로 덮어쓰지 않는다.
 * 저장소 접근 자체가 막히는 환경(시크릿 모드, 사이트 데이터 차단)이 있으므로
 * 모든 접근을 try/catch 로 감싼다 — 세션이 없는 것으로 취급하면 참가 화면으로
 * 가게 되고, 그게 앱이 죽는 것보다 낫다.
 */
export function loadSession(roomCode: string): Session | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(keyFor(roomCode));
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.participantToken === 'string' &&
      typeof parsed.participantId === 'string' &&
      typeof parsed.nickname === 'string'
    ) {
      return parsed as Session;
    }
  } catch {
    // 아래에서 지운다
  }

  clearSession(roomCode);
  return null;
}

export function saveSession(roomCode: string, session: Session): void {
  try {
    localStorage.setItem(keyFor(roomCode), JSON.stringify(session));
  } catch {
    // 저장하지 못해도 이번 세션 동안은 메모리 상태로 게임을 계속할 수 있다
  }
}

export function clearSession(roomCode: string): void {
  try {
    localStorage.removeItem(keyFor(roomCode));
  } catch {
    // 무시
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run lib/session
```

Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/session.ts lib/session.test.ts
git commit -m "feat: 방별 localStorage 세션 저장소 추가

시크릿 모드처럼 저장소 접근이 막히는 환경에서도 던지지 않는다.
세션이 없는 것으로 취급되어 참가 화면으로 가는 편이 앱이 죽는 것보다 낫다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 5: 공개 타이밍과 결정적 셔플

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `lib/reveal.ts`
- Create: `lib/shuffle.ts`
- Test: `lib/reveal.test.ts`, `lib/shuffle.test.ts`

**Interfaces:**
- Produces:
  - `const STAGGER_MS = 700`
  - `interface CardTiming { index: number; delayMs: number }`
  - `revealTimings(revealedAt: string | null, now: number, count: number): CardTiming[]`
  - `seededShuffle<T>(items: readonly T[], seed: string): T[]`

**이 태스크가 이 앱에서 유일한 진짜 로직이다.** 나머지는 화면과 호출이다.

- [ ] **Step 1: 공개 타이밍 실패 테스트**

`lib/reveal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { revealTimings, STAGGER_MS } from './reveal';

const T0 = '2026-09-09T12:00:00.000Z';
const t0 = Date.parse(T0);

describe('revealTimings', () => {
  it('공개 시각에 정확히 도착하면 STAGGER 간격으로 열린다', () => {
    expect(revealTimings(T0, t0, 3).map((c) => c.delayMs)).toEqual([
      0,
      STAGGER_MS,
      STAGGER_MS * 2,
    ]);
  });

  it('늦게 도착하면 이미 지난 카드는 즉시, 남은 것만 남은 시간만큼 기다린다', () => {
    // 800ms 늦게 도착: 0번(0ms)과 1번(700ms)은 지났고, 2번(1400ms)은 600ms 남았다
    expect(revealTimings(T0, t0 + 800, 3).map((c) => c.delayMs)).toEqual([0, 0, 600]);
  });

  it('연출이 다 끝난 뒤 도착하면 전부 즉시', () => {
    expect(revealTimings(T0, t0 + 10_000, 3).map((c) => c.delayMs)).toEqual([0, 0, 0]);
  });

  it('경계: 카드가 열릴 시각과 정확히 같은 순간이면 즉시로 친다', () => {
    expect(revealTimings(T0, t0 + STAGGER_MS, 2).map((c) => c.delayMs)).toEqual([0, 0]);
  });

  it('revealedAt 이 null 이면 연출 없이 전부 즉시', () => {
    expect(revealTimings(null, t0, 3).map((c) => c.delayMs)).toEqual([0, 0, 0]);
  });

  it('기기 시계가 어긋나 공개 시각이 미래로 계산되면 전부 즉시', () => {
    // 음수 지연으로 연출이 멈추는 것보다 즉시 보여주는 편이 낫다
    expect(revealTimings(T0, t0 - 5_000, 3).map((c) => c.delayMs)).toEqual([0, 0, 0]);
  });

  it('파싱할 수 없는 시각이면 전부 즉시', () => {
    expect(revealTimings('어제', t0, 2).map((c) => c.delayMs)).toEqual([0, 0]);
  });

  it('답변이 없으면 빈 배열', () => {
    expect(revealTimings(T0, t0, 0)).toEqual([]);
  });

  it('index 는 0부터 순서대로 붙는다', () => {
    expect(revealTimings(T0, t0, 3).map((c) => c.index)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: 셔플 실패 테스트**

`lib/shuffle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { seededShuffle } from './shuffle';

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

describe('seededShuffle', () => {
  it('같은 시드면 항상 같은 순서 — 모든 참가자가 같은 순서를 본다', () => {
    expect(seededShuffle(items, '11')).toEqual(seededShuffle(items, '11'));
  });

  it('다른 시드면 다른 순서', () => {
    expect(seededShuffle(items, '11')).not.toEqual(seededShuffle(items, '12'));
  });

  it('원소를 잃거나 늘리지 않는다', () => {
    const shuffled = seededShuffle(items, '11');
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const original = [...items];
    seededShuffle(items, '11');
    expect(items).toEqual(original);
  });

  it('제출 순서를 그대로 두지 않는다 — 빨리 낸 사람이 항상 1번이면 안 된다', () => {
    expect(seededShuffle(items, '11')).not.toEqual(items);
  });

  it('빈 배열과 한 개짜리도 처리한다', () => {
    expect(seededShuffle([], '11')).toEqual([]);
    expect(seededShuffle(['a'], '11')).toEqual(['a']);
  });
});
```

- [ ] **Step 3: 실패 확인**

```bash
npx vitest run lib/reveal lib/shuffle
```

Expected: FAIL — 두 모듈 다 없음

- [ ] **Step 4: 구현**

`lib/reveal.ts`:

```typescript
export const STAGGER_MS = 700;

export interface CardTiming {
  index: number;
  delayMs: number;
}

/**
 * 공개 연출의 타이밍을 서버가 준 revealedAt 기준으로 계산한다.
 *
 * 폴링은 2초 간격이라 사람마다 공개를 감지하는 시점이 최대 2초까지 어긋난다.
 * 감지 시점에 연출을 시작하면 같이 있는 친구들이 다른 순간에 답을 보게 되는데,
 * 다 같이 보는 것이 이 게임의 전부다. 그래서 모두가 공유하는 값인 revealedAt 을
 * 기준점으로 삼는다. 그러면 폴링이 언제 도착했든 카드가 열리는 벽시계 시각이 같다.
 *
 * 늦게 도착한 클라이언트는 이미 지난 카드를 즉시 펼쳐놓고 남은 것만 함께 본다.
 */
export function revealTimings(
  revealedAt: string | null,
  now: number,
  count: number,
): CardTiming[] {
  const immediate = () =>
    Array.from({ length: count }, (_, index) => ({ index, delayMs: 0 }));

  if (revealedAt === null) return immediate();

  const t0 = Date.parse(revealedAt);
  // 파싱 불가, 또는 기기 시계가 어긋나 공개 시각이 미래인 경우.
  // 음수 지연으로 연출이 멈추느니 즉시 보여준다.
  if (Number.isNaN(t0) || t0 > now) return immediate();

  return Array.from({ length: count }, (_, index) => {
    const dueAt = t0 + STAGGER_MS * index;
    return { index, delayMs: dueAt <= now ? 0 : dueAt - now };
  });
}
```

`lib/shuffle.ts`:

```typescript
/**
 * 시드가 같으면 항상 같은 결과를 내는 셔플.
 *
 * 서버는 답변을 제출 시각순으로 준다. 그대로 보여주면 제일 빨리 낸 사람이
 * 항상 1번이라 몇 판 하면 읽힌다. roundId 를 시드로 섞으면 모든 참가자가
 * 같은 순서를 보면서도 순서가 제출 시각과 무관해진다.
 *
 * 암호학적 용도가 아니다. 재현성만 있으면 된다.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const random = mulberry32(hashSeed(seed));

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 5: 통과 확인**

```bash
npx vitest run lib/reveal lib/shuffle
```

Expected: PASS (reveal 9 + shuffle 6 = 15 tests)

`'제출 순서를 그대로 두지 않는다'` 테스트가 시드 `'11'` 과 8개 원소에서 우연히 항등이면 실패한다. 실패하면 **구현을 바꾸지 말고** 보고할 것 — 다른 시드 값으로 테스트를 조정하는 것이 맞는 대응이다.

- [ ] **Step 6: 커밋**

```bash
git add lib/reveal.ts lib/reveal.test.ts lib/shuffle.ts lib/shuffle.test.ts
git commit -m "feat: 공개 타이밍 계산과 결정적 셔플 추가

폴링 시점이 최대 2초까지 어긋나므로 감지 시점이 아니라 서버가 준
revealedAt 을 기준으로 계산한다. 늦게 받은 클라이언트는 지난 카드를
즉시 펼치고 남은 것만 다른 사람과 같은 순간에 본다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 6: 폴링 대상 결정

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `lib/polling.ts`
- Test: `lib/polling.test.ts`

**Interfaces:**
- Consumes: `RoomState` (Task 3)
- Produces:
  - `const POLL_INTERVAL_MS = 2000`
  - `type PollTarget = { kind: 'room' } | { kind: 'round'; roundId: string }`
  - `pollTarget(room: RoomState | undefined): PollTarget`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/polling.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pollTarget } from './polling';
import type { RoomState } from './types';

const room = (currentRound: RoomState['currentRound']): RoomState => ({
  code: 'K3P9XM',
  status: currentRound ? 'playing' : 'waiting',
  isHost: true,
  participants: [],
  currentRound,
});

describe('pollTarget', () => {
  it('방 정보를 아직 못 받았으면 방을 본다', () => {
    expect(pollTarget(undefined)).toEqual({ kind: 'room' });
  });

  it('라운드가 없으면 방을 본다 — 누가 들어오는지, 방장이 시작하는지', () => {
    expect(pollTarget(room(null))).toEqual({ kind: 'room' });
  });

  it('라운드가 열려 있으면 라운드를 본다', () => {
    expect(pollTarget(room({ id: '10', sequence: 1, status: 'open' }))).toEqual({
      kind: 'round',
      roundId: '10',
    });
  });

  it('공개된 라운드면 다시 방을 본다', () => {
    // 공개된 라운드는 더 이상 변하지 않는다. 계속 그걸 폴링하면
    // 방장이 다음 라운드를 시작한 것을 영영 모른다.
    expect(pollTarget(room({ id: '10', sequence: 1, status: 'revealed' }))).toEqual({
      kind: 'room',
    });
  });

  it('스킵된 라운드도 다시 방을 본다', () => {
    expect(pollTarget(room({ id: '10', sequence: 1, status: 'skipped' }))).toEqual({
      kind: 'room',
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/polling
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`lib/polling.ts`:

```typescript
import type { RoomState } from './types';

export const POLL_INTERVAL_MS = 2000;

export type PollTarget = { kind: 'room' } | { kind: 'round'; roundId: string };

/**
 * 한 번에 하나만 폴링한다.
 *
 * 라운드가 열려 있는 동안에는 라운드 응답이 참가자 목록과 제출 여부를 모두
 * 주므로 방을 함께 볼 이유가 없다.
 *
 * 공개되거나 스킵된 뒤에는 반드시 방으로 되돌아가야 한다. 끝난 라운드는 더 이상
 * 변하지 않으므로 계속 폴링하면 방장이 다음 라운드를 시작한 것을 감지하지 못한다.
 */
export function pollTarget(room: RoomState | undefined): PollTarget {
  const round = room?.currentRound;
  if (round && round.status === 'open') {
    return { kind: 'round', roundId: round.id };
  }
  return { kind: 'room' };
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run lib/polling
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/polling.ts lib/polling.test.ts
git commit -m "feat: 상태별 폴링 대상 결정 로직 추가

공개·스킵된 뒤에는 방 폴링으로 되돌아간다. 끝난 라운드를 계속 보면
방장이 다음 라운드를 시작한 것을 감지하지 못한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 7: 앱 셸과 시작·참가 화면

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `app/providers.tsx`
- Modify: `app/layout.tsx`, `app/globals.css`
- Modify: `app/page.tsx`
- Create: `app/join/[code]/page.tsx`
- Create: `components/ui/Button.tsx`, `components/ui/TextField.tsx`
- Test: `app/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` (Task 3), `saveSession`, `loadSession` (Task 4)
- Produces: 동작하는 방 생성·참가 흐름. Task 8 이 `/room/[code]` 를 이어받는다.

- [ ] **Step 1: Query 프로바이더**

`app/providers.tsx`:

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 폴링 실패가 화면을 비우면 안 된다. 마지막 데이터를 유지한다.
            retry: 2,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

`app/layout.tsx` 에서 `<body>` 안을 `<Providers>` 로 감싼다. `metadata` 의 `title` 은 `'다 적으면 공개'`, `description` 은 `'친구들끼리 각자 답을 적고, 전원이 제출하면 한꺼번에 공개되는 게임'` 으로 바꾼다.

- [ ] **Step 2: 공용 UI**

`components/ui/Button.tsx` 와 `components/ui/TextField.tsx` 를 만든다. 요구사항만 정하고 시각적 선택은 구현자에게 맡긴다:

- `Button`: `variant` 로 `primary` / `ghost` / `danger` 를 구분한다. `disabled` 와 `loading` 상태를 받고, `loading` 이면 비활성화되며 진행 중임이 보여야 한다. 모바일 탭 대상이므로 최소 높이 44px.
- `TextField`: `label`, `value`, `onChange`, `error`, `maxLength` 를 받는다. `error` 가 있으면 문구를 필드 아래에 보여준다.

둘 다 `'use client'` 다.

- [ ] **Step 3: 시작 화면 실패 테스트**

`app/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HomePage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

describe('시작 화면', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('닉네임이 비어 있으면 방을 만들 수 없다', () => {
    render(<HomePage />);
    expect(screen.getByRole('button', { name: /방 만들기/ })).toBeDisabled();
  });

  it('방 코드는 소문자로 입력해도 대문자가 된다', () => {
    render(<HomePage />);
    const input = screen.getByLabelText(/방 코드/);
    fireEvent.change(input, { target: { value: 'k3p9xm' } });
    expect(input).toHaveValue('K3P9XM');
  });

  it('방 코드가 6자가 아니면 참가할 수 없다', () => {
    render(<HomePage />);
    fireEvent.change(screen.getByLabelText(/방 코드/), { target: { value: 'K3P' } });
    expect(screen.getByRole('button', { name: /참가/ })).toBeDisabled();
  });
});
```

- [ ] **Step 4: 실패 확인 후 구현**

```bash
npx vitest run app/page
```

Expected: FAIL

`app/page.tsx` (`'use client'`):

- 닉네임 입력(1~20자, 앞뒤 공백은 제출 시 trim)과 "방 만들기" 버튼
- 방 코드 입력(6자, 입력 시 `toUpperCase()`)과 "참가" 버튼
- "방 만들기" → `apiFetch<CreateRoomResult>('/rooms', { method: 'POST', body: { nickname } })` → `saveSession(code, {...})` → `router.push('/room/' + code)`
- "참가" → `router.push('/join/' + code)` (닉네임은 그 화면에서 받는다)
- 실패하면 `ApiError.message` 를 그대로 보여준다

- [ ] **Step 5: 참가 화면**

`app/join/[code]/page.tsx` (`'use client'`):

- URL 의 `code` 를 읽는다. Next 16 에서 `params` 는 Promise 이므로 `use(params)` 로 푼다.
- 마운트 시 `loadSession(code)` 가 있으면 곧바로 `router.replace('/room/' + code)` — 이미 참가한 사람은 닉네임을 다시 묻지 않는다
- 닉네임을 받아 `apiFetch<JoinRoomResult>('/rooms/' + code + '/participants', { method: 'POST', body: { nickname } })`
- 성공하면 `saveSession` 후 `/room/[code]` 로
- 409 면 `ApiError.message` 를 필드 아래에 보여주고 다시 입력받는다 (중복 닉네임)
- 404 면 "방을 찾을 수 없어요" 와 시작 화면으로 가는 링크

- [ ] **Step 6: 통과 확인**

```bash
npm test
npm run build
```

Expected: 전부 통과, 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 앱 셸과 시작·참가 화면 추가

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 8: 게임 화면 골격과 대기실

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `app/room/[code]/page.tsx`
- Create: `app/room/[code]/useGameState.ts`
- Create: `components/game/Lobby.tsx`
- Test: `app/room/[code]/useGameState.test.tsx`

**Interfaces:**
- Consumes: `pollTarget`, `POLL_INTERVAL_MS` (Task 6), `loadSession`, `clearSession` (Task 4), `apiFetch`, `ApiError` (Task 3)
- Produces:
  - `useGameState(code: string, session: Session | null): { room?: RoomState; round?: RoundState; isLoading: boolean; error?: ApiError }`

- [ ] **Step 1: 게임 상태 훅**

`app/room/[code]/useGameState.ts` — 이 앱의 데이터 흐름 전부가 여기 모인다.

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { pollTarget, POLL_INTERVAL_MS } from '@/lib/polling';
import { loadSession, type Session } from '@/lib/session';
import type { RoomState, RoundState } from '@/lib/types';

export function useGameState(code: string, session: Session | null) {
  const token = session?.participantToken;

  const roomQuery = useQuery({
    queryKey: ['room', code],
    queryFn: () => apiFetch<RoomState>(`/rooms/${code}`, { token }),
    enabled: Boolean(token),
    refetchInterval: (query) =>
      pollTarget(query.state.data).kind === 'room' ? POLL_INTERVAL_MS : false,
  });

  const target = pollTarget(roomQuery.data);
  const roundId =
    target.kind === 'round'
      ? target.roundId
      : roomQuery.data?.currentRound?.id;

  const roundQuery = useQuery({
    queryKey: ['round', roundId],
    queryFn: () => apiFetch<RoundState>(`/rounds/${roundId}`, { token }),
    enabled: Boolean(token) && Boolean(roundId),
    refetchInterval: target.kind === 'round' ? POLL_INTERVAL_MS : false,
  });

  return {
    room: roomQuery.data,
    round: roundQuery.data,
    isLoading: roomQuery.isLoading,
    error: (roomQuery.error ?? roundQuery.error) as ApiError | undefined,
  };
}
```

두 곳을 눈여겨볼 것:

- **방 폴링은 `pollTarget` 이 `room` 일 때만 돈다.** 라운드가 열려 있는 동안 방을 함께 폴링하면 같은 정보를 두 번 가져오게 된다.
- **라운드는 끝난 뒤에도 한 번은 가져온다.** `roundId` 를 `target.kind` 와 무관하게 채우는 이유다 — 공개된 답변을 그려야 하는데 폴링만 멈추면 된다.

- [ ] **Step 2: 훅 테스트**

`app/room/[code]/useGameState.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useGameState } from './useGameState';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiError: class extends Error {} }));

const session = { participantToken: 'tok', participantId: '1', nickname: '지훈' };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useGameState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('라운드가 없으면 방만 가져온다', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      code: 'K3P9XM', status: 'waiting', isHost: true,
      participants: [], currentRound: null,
    } as never);

    const { result } = renderHook(() => useGameState('K3P9XM', session), { wrapper });

    await waitFor(() => expect(result.current.room).toBeDefined());
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.startsWith('/rooms/'))).toBe(true);
  });

  it('라운드가 열려 있으면 라운드도 가져온다', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) =>
      path.startsWith('/rooms/')
        ? Promise.resolve({
            code: 'K3P9XM', status: 'playing', isHost: true, participants: [],
            currentRound: { id: '10', sequence: 1, status: 'open' },
          } as never)
        : Promise.resolve({
            roundId: '10', status: 'open',
            question: { id: '42', text: '질문?' },
            participants: [], mySubmission: null,
          } as never),
    );

    const { result } = renderHook(() => useGameState('K3P9XM', session), { wrapper });

    await waitFor(() => expect(result.current.round).toBeDefined());
    expect(result.current.round?.status).toBe('open');
  });

  it('세션이 없으면 아무것도 요청하지 않는다', () => {
    renderHook(() => useGameState('K3P9XM', null), { wrapper });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 게임 화면 골격**

`app/room/[code]/page.tsx` (`'use client'`):

- `use(params)` 로 `code` 를 얻는다
- `useEffect` 로 `loadSession(code)` 를 읽어 상태에 넣는다. 없으면 `router.replace('/join/' + code)`
- `useGameState(code, session)` 호출
- `error?.status === 401` 이면 `clearSession(code)` 후 `/join/[code]` 로
- 상태에 따라 하위 컴포넌트를 고른다:

```
round 없음                → <Lobby />
round.status === 'open'   → mySubmission 있으면 <Waiting />, 없으면 <AnswerForm />   (Task 9)
round.status === 'revealed' → <Reveal />                                            (Task 10)
round.status === 'skipped'  → <Skipped />                                           (Task 9)
```

`Waiting` / `AnswerForm` / `Reveal` / `Skipped` 는 아직 없으므로 이 태스크에서는 자리만 만들고 `null` 을 렌더한다. Task 9, 10 에서 채운다.

- [ ] **Step 4: 대기실**

`components/game/Lobby.tsx` — props: `{ room: RoomState; onStart: () => void; starting: boolean }`

- 방 코드를 크게 보여준다 (친구에게 불러줄 수 있게)
- 초대 링크 복사 버튼: `${location.origin}/join/${room.code}` 를 클립보드로. 복사되면 "복사됨" 피드백
- 참가자 목록. 방장에게 표시를 단다
- 방장에게만 "시작하기" 버튼. 비방장에게는 "방장이 시작하기를 기다리는 중" 안내
- 시작: `apiFetch<StartRoundResult>('/rooms/' + code + '/rounds', { method: 'POST', token })` 후 방 쿼리를 무효화

`navigator.clipboard` 는 HTTPS 나 localhost 에서만 동작한다. 실패하면 링크를 선택 가능한 텍스트로 보여주는 대체 경로를 둔다.

- [ ] **Step 5: 확인**

```bash
npm test
npm run build
```

Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 게임 화면 골격과 대기실 추가

폴링은 pollTarget 에 따라 방과 라운드 중 하나만 돈다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 9: 답변 작성 · 대기 중 · 스킵

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `components/game/AnswerForm.tsx`
- Create: `components/game/Waiting.tsx`
- Create: `components/game/Skipped.tsx`
- Modify: `app/room/[code]/page.tsx` (자리 채우기)
- Test: `components/game/Waiting.test.tsx`

**Interfaces:**
- Consumes: `RoundOpen`, `RoundSkipped` (Task 3)
- Produces: 화면 전환이 완성된 게임 루프. Task 10 이 공개만 채우면 끝난다.

- [ ] **Step 1: AnswerForm**

props: `{ round: RoundOpen; onSubmit: (text: string) => void; submitting: boolean; error?: string }`

- 질문을 화면의 주인공으로 크게
- 여러 줄 입력. 1~500자. 남은 글자 수 표시
- "N명 중 M명이 냈어요" — `round.participants.filter(p => p.submitted).length`
- 제출 버튼. 빈 값이면 비활성
- 제출: `apiFetch<SubmitAnswerResult>('/rounds/' + roundId + '/answers', { method: 'POST', body: { text }, token })`
- 제출 성공 후 라운드 쿼리를 무효화하면 `mySubmission` 이 채워져 자동으로 `Waiting` 으로 넘어간다

**한 번 내면 수정할 수 없다.** 제출 버튼 옆에 그 사실을 미리 알린다 — 낸 뒤에 알면 화난다.

- [ ] **Step 2: Waiting**

props: `{ round: RoundOpen; isHost: boolean; onReveal: () => void; onSkip: () => void; busy: boolean }`

- 내 답변을 보여준다 (`round.mySubmission.text`)
- 참가자별 제출 여부를 실시간으로. 낸 사람과 안 낸 사람이 한눈에 구분되어야 한다 — 여기가 긴장이 쌓이는 화면이다
- 방장에게만 "그냥 공개" 와 "이 질문 넘기기". 둘 다 되돌릴 수 없으니 확인 단계를 둔다
- 비방장에게는 "다 모이면 자동으로 열려요" 안내

- [ ] **Step 3: Waiting 테스트 — 유출 방지**

`components/game/Waiting.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Waiting } from './Waiting';
import type { RoundOpen } from '@/lib/types';

const round: RoundOpen = {
  roundId: '10',
  status: 'open',
  question: { id: '42', text: '무중력에서 라면을 끓이면 국물은 어떻게 먹을까?' },
  participants: [
    { id: '1', nickname: '지훈', submitted: true },
    { id: '2', nickname: '민수', submitted: true },
    { id: '3', nickname: '영희', submitted: false },
  ],
  mySubmission: { text: '내가 쓴 답' },
};

describe('Waiting', () => {
  const noop = () => {};

  it('내 답변은 보여준다', () => {
    render(<Waiting round={round} isHost={false} onReveal={noop} onSkip={noop} busy={false} />);
    expect(screen.getByText('내가 쓴 답')).toBeInTheDocument();
  });

  it('누가 냈고 누가 안 냈는지 보여준다', () => {
    render(<Waiting round={round} isHost={false} onReveal={noop} onSkip={noop} busy={false} />);
    expect(screen.getByText('지훈')).toBeInTheDocument();
    expect(screen.getByText('영희')).toBeInTheDocument();
  });

  it('방장이 아니면 공개·스킵 버튼이 없다', () => {
    render(<Waiting round={round} isHost={false} onReveal={noop} onSkip={noop} busy={false} />);
    expect(screen.queryByRole('button', { name: /공개/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /넘기기/ })).toBeNull();
  });

  it('방장이면 공개·스킵 버튼이 있다', () => {
    render(<Waiting round={round} isHost onReveal={noop} onSkip={noop} busy={false} />);
    expect(screen.getByRole('button', { name: /공개/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /넘기기/ })).toBeInTheDocument();
  });
});
```

`RoundOpen` 타입에는 남의 답변 텍스트를 담을 필드 자체가 없다. 유출은 타입 단계에서 이미 불가능하고, 이 테스트는 화면이 그 사실을 유지하는지 확인한다.

- [ ] **Step 4: Skipped**

props: `{ round: RoundSkipped; isHost: boolean; onNext: () => void; busy: boolean }`

- 질문과 "이 질문은 넘어갔어요"
- **답변은 어디에도 표시하지 않는다.** 백엔드도 응답에 담지 않는다 — 스킵된 라운드는 공개된 적이 없다
- 방장에게만 "다음 질문"

- [ ] **Step 5: 화면 전환 연결**

Task 8 에서 `null` 로 비워둔 자리를 채운다. `AnswerForm` / `Waiting` 은 `round.status === 'open'` 안에서 `round.mySubmission` 유무로 가른다.

- [ ] **Step 6: 확인**

```bash
npm test
npm run build
```

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 답변 작성·대기 중·스킵 화면 추가

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 10: 공개 연출

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Create: `components/game/Reveal.tsx`
- Modify: `app/room/[code]/page.tsx`
- Test: `components/game/Reveal.test.tsx`

**Interfaces:**
- Consumes: `revealTimings`, `STAGGER_MS` (Task 5), `seededShuffle` (Task 5), `RoundRevealed` (Task 3)

**이 화면이 이 게임의 클라이맥스다.** 나머지는 여기까지 오는 길이다.

- [ ] **Step 1: 구현**

`components/game/Reveal.tsx` (`'use client'`) — props: `{ round: RoundRevealed; isHost: boolean; onNext: () => void; busy: boolean }`

동작:

1. 마운트 시 한 번 `const order = seededShuffle(round.answers, round.roundId)` 로 순서를 고정한다. `useMemo` 로 감싸 리렌더마다 다시 섞이지 않게 한다.
2. `const timings = revealTimings(round.revealedAt, Date.now(), order.length)` 를 마운트 시 한 번 계산한다.
3. 각 카드는 `timings[i].delayMs` 뒤에 나타난다. `motion/react` 의 `motion.div` 에 `initial={{ opacity: 0, y: 16 }}`, `animate={{ opacity: 1, y: 0 }}`, `transition={{ delay: delayMs / 1000, duration: 0.35 }}` 를 준다.
4. 카드에는 닉네임과 답변 본문이 들어간다.
5. `round.notSubmitted` 가 비어 있지 않으면 카드가 다 열린 뒤 "○○님은 끝내 안 냈어요" 를 보여준다.
6. `round.revealedBy` 가 있으면 "방장이 먼저 열었어요", 없으면 자동 공개다.
7. 방장에게만 "다음 질문".

```tsx
const order = useMemo(
  () => seededShuffle(round.answers, round.roundId),
  [round.answers, round.roundId],
);

const timings = useMemo(
  () => revealTimings(round.revealedAt, Date.now(), order.length),
  // Date.now() 는 의도적으로 의존성에서 뺀다. 마운트 시 한 번만 계산해야
  // 리렌더마다 지연이 다시 계산돼 카드가 늦게 열리는 일이 없다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [round.roundId, order.length],
);
```

`Date.now()` 를 의존성에 넣지 않는 것이 중요하다. 넣으면 리렌더마다 타이밍이 다시 계산돼 연출이 어긋난다.

- [ ] **Step 2: 테스트**

`components/game/Reveal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Reveal } from './Reveal';
import type { RoundRevealed } from '@/lib/types';

const REVEALED_AT = '2026-09-09T12:00:00.000Z';

const round: RoundRevealed = {
  roundId: '11',
  status: 'revealed',
  question: { id: '42', text: '무중력에서 라면을 끓이면?' },
  revealedAt: REVEALED_AT,
  revealedBy: null,
  answers: [
    { participantId: '1', nickname: '지훈', text: '빨대로 마신다' },
    { participantId: '2', nickname: '민수', text: '그냥 안 먹는다' },
  ],
  notSubmitted: [],
};

describe('Reveal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const noop = () => {};

  it('모든 답변과 작성자를 보여준다', () => {
    vi.setSystemTime(Date.parse(REVEALED_AT) + 10_000);
    render(<Reveal round={round} isHost={false} onNext={noop} busy={false} />);

    expect(screen.getByText('빨대로 마신다')).toBeInTheDocument();
    expect(screen.getByText('그냥 안 먹는다')).toBeInTheDocument();
    expect(screen.getByText('지훈')).toBeInTheDocument();
  });

  it('강제 공개면 안 낸 사람을 따로 보여준다', () => {
    vi.setSystemTime(Date.parse(REVEALED_AT) + 10_000);
    render(
      <Reveal
        round={{
          ...round,
          revealedBy: { id: '1', nickname: '지훈', isHost: true },
          notSubmitted: [{ id: '3', nickname: '영희', isHost: false }],
        }}
        isHost={false}
        onNext={noop}
        busy={false}
      />,
    );

    expect(screen.getByText(/영희/)).toBeInTheDocument();
  });

  it('방장이 아니면 다음 질문 버튼이 없다', () => {
    vi.setSystemTime(Date.parse(REVEALED_AT) + 10_000);
    render(<Reveal round={round} isHost={false} onNext={noop} busy={false} />);
    expect(screen.queryByRole('button', { name: /다음 질문/ })).toBeNull();
  });

  it('답변이 없어도 죽지 않는다', () => {
    vi.setSystemTime(Date.parse(REVEALED_AT) + 10_000);
    expect(() =>
      render(<Reveal round={{ ...round, answers: [] }} isHost onNext={noop} busy={false} />),
    ).not.toThrow();
  });
});
```

`vi.setSystemTime` 으로 공개 시각보다 한참 뒤를 만들면 모든 카드가 지연 0으로 즉시 렌더되므로, 애니메이션 타이밍과 무관하게 내용을 검증할 수 있다.

- [ ] **Step 3: 확인**

```bash
npm test
npm run build
```

- [ ] **Step 4: 두 브라우저로 동기화 육안 확인**

이건 자동 테스트로 잡히지 않는다. 로컬에서 `npm run dev` 로 띄우고, 일반 창과 시크릿 창으로 각각 다른 참가자로 들어가 라운드를 끝까지 진행한다.

Expected: 두 창의 카드가 **같은 순간에** 열린다. 한 창을 잠시 다른 탭으로 가렸다가 돌아와도(폴링이 멈췄다 재개돼도) 이미 지난 카드는 펼쳐져 있고 남은 카드는 다른 창과 동시에 열린다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 공개 연출 추가

revealedAt 을 기준으로 타이밍을 계산해 폴링 시점이 달라도 모든
참가자가 같은 순간에 답을 본다. 카드 순서는 roundId 시드로 섞어
제출이 빠른 사람이 항상 먼저 나오지 않게 했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 11: 마감 — 반응형·에러·연결 상태

**레포:** `~/Desktop/quiz-app-web`

**Files:**
- Modify: `app/globals.css`, 모든 `components/`, 모든 `app/` 페이지
- Create: `components/ui/ConnectionBadge.tsx`
- Create: `components/ui/ErrorScreen.tsx`

- [ ] **Step 1: 에러 화면**

`components/ui/ErrorScreen.tsx` — props: `{ status: number; message: string }`

스펙의 표대로 문구를 정한다:

| status | 문구 |
|---|---|
| 403 | "이 방 참가자가 아니에요" |
| 404 | "방을 찾을 수 없어요" |
| 0 | "서버에 연결할 수 없어요" |
| 그 외 | 백엔드가 준 `message` |

시작 화면으로 돌아가는 링크를 함께 둔다. 401 은 여기 오지 않는다 — `page.tsx` 가 세션을 지우고 참가 화면으로 보낸다.

- [ ] **Step 2: 연결 상태 표시**

`components/ui/ConnectionBadge.tsx` — 폴링이 실패 중일 때만 화면 구석에 "연결 중" 을 띄운다. **화면을 비우지 않는다.** 답변을 쓰던 중에 잠깐 끊겼다고 입력이 날아가면 최악이다.

TanStack Query 의 `isError` 와 `isFetching` 을 조합해 "마지막 성공 이후 실패가 이어지는 중" 을 판단한다.

- [ ] **Step 3: 반응형**

기준 화면은 세로 모드 휴대폰이다. 친구들끼리 둘러앉아 각자 폰으로 하는 게임이다.

- 모든 탭 대상 최소 44px
- 질문 텍스트는 작은 화면에서도 읽히는 크기로. 화면의 주인공이다
- 참가자 목록이 8명을 넘어도 무너지지 않게
- 답변 카드는 긴 답변에서 넘치지 않게 (`overflow-wrap: anywhere`)
- 데스크톱에서는 가운데 정렬된 최대 너비 컨테이너

- [ ] **Step 4: 빈 상태와 경계**

- 대기실에 나 혼자일 때: "친구를 초대하세요" 와 링크 복사 유도
- 질문 풀이 소진되면 라운드 시작이 409 로 실패한다. 백엔드 메시지("이 방에서 낼 수 있는 질문이 더 이상 없습니다")를 그대로 보여준다
- 아주 긴 닉네임(20자)이 레이아웃을 깨지 않게

- [ ] **Step 5: 확인**

```bash
npm test
npm run build
```

브라우저 개발자도구의 기기 모드로 좁은 화면(375px)에서 전 화면을 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 반응형 마감과 에러·연결 상태 표시 추가

폴링 실패 시 화면을 비우지 않고 마지막 데이터를 유지한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## Task 12: Vercel 배포와 연결

**레포:** 양쪽 다

**Files:**
- Create: `README.md` (quiz-app-web)

- [ ] **Step 1: 푸시 승인 요청**

여기까지의 커밋을 푸시해야 Vercel 이 배포할 수 있다. **사용자에게 명시적으로 승인을 받는다.**

- [ ] **Step 2: Vercel 프로젝트 연결**

Vercel CLI 는 이미 개인 스코프(`jihuns-projects-67e3e831`)로 전환돼 있다.

```bash
cd ~/Desktop/quiz-app-web
vercel link
vercel env add NEXT_PUBLIC_API_BASE production
# 값: https://quiz-app-production-6e37.up.railway.app
vercel --prod
```

배포된 도메인을 기록한다.

- [ ] **Step 3: 백엔드에 CORS 오리진 설정**

Railway 환경변수에 Vercel 도메인을 넣는다:

```bash
TOKEN_FILE="$(jq -r '.projects["quiz-app"].envs.prod.credentials.RAILWAY_TOKEN' ~/.claude/project-accounts.json | sed 's|^@file:||; s|^~|'"$HOME"'|')"
SERVICE="$(jq -r '.projects["quiz-app"].envs.prod.services.backend.service' ~/.claude/project-accounts.json)"
RAILWAY_TOKEN="$(cat "$TOKEN_FILE")" railway variables set --service "$SERVICE" "CORS_ORIGINS=https://<vercel-도메인>"
```

설정 후 재배포가 필요하면 재배포한다.

- [ ] **Step 4: preflight 확인**

```bash
curl -s -i -X OPTIONS https://quiz-app-production-6e37.up.railway.app/rooms \
  -H "Origin: https://<vercel-도메인>" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: x-participant-token,content-type" | grep -i "access-control"
```

Expected: `Access-Control-Allow-Origin` 이 Vercel 도메인이고, `Access-Control-Allow-Headers` 에 `x-participant-token` 이 들어있다.

- [ ] **Step 5: 배포된 앱으로 전체 흐름 확인**

실제 브라우저 두 개(일반 창 + 시크릿 창)로:

1. 방 만들기 → 코드가 나온다
2. 초대 링크를 시크릿 창에서 열어 다른 닉네임으로 참가
3. 방장이 라운드 시작 → 양쪽에 질문이 뜬다
4. 한 명만 제출 → 그 사람은 대기 화면, 다른 사람은 여전히 작성 화면. **남의 답변이 안 보인다**
5. 나머지가 제출 → 양쪽에서 같은 순간에 카드가 열린다
6. 새로고침 → 재접속되어 공개된 답변이 그대로 보인다
7. 방장이 "다음 질문" → 양쪽에 새 질문이 뜬다

- [ ] **Step 6: README 와 커밋**

`README.md` 에 로컬 실행 방법, 환경변수, 백엔드 레포 링크를 적는다.

```bash
git add README.md
git commit -m "docs: README 추가

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WpXfupFmRo2repLqi8Pjo5"
```

---

## 완료 기준

```bash
cd ~/Desktop/quiz-app-web
npm test        # 전부 통과
npm run build   # 성공
```

그리고 배포된 앱에서 Task 12 Step 5 의 7단계가 전부 동작한다. 특히 **4번(공개 전 남의 답변이 안 보인다)과 5번(같은 순간에 열린다)** 이 이 앱의 존재 이유다.
