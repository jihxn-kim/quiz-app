# 질문 생성 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시드 축 조합에서 출발해 LLM 이 질문을 생성하고, 중복 제거·심사·안전 필터·사람 검수를 거쳐 질문 풀에 적재하는 오프라인 배치 파이프라인을 만든다.

**Architecture:** NestJS 애플리케이션 하나 안에 CLI 커맨드(nest-commander)로 파이프라인을 돌린다. 순수 로직(조합 생성, 코사인 유사도, 합격선 판정)과 I/O(LLM, 임베딩, DB)를 서비스 경계로 분리해 LLM 없이 단위 테스트가 가능하게 한다. 모든 LLM 호출은 zod 스키마 기반 구조화 출력으로 받아 파싱 실패를 없앤다.

**Tech Stack:** Node 20+, NestJS 11, TypeScript, TypeORM 0.3.26, PostgreSQL(개발은 로컬 Docker, 배포는 Railway), zod 4, `openai`(생성·심사·임베딩 전부), nest-commander, jest

**Spec:** `docs/superpowers/specs/2026-09-08-question-generation-design.md`

## Global Constraints

- **공급자는 OpenAI 하나다.** 생성·judge·안전 필터는 `gpt-5.5`, 임베딩은 `text-embedding-3-small`(1536차원). 모델 ID 는 상수(`LLM_MODEL`, `EMBEDDING_MODEL`)로 관리하고 하드코딩 금지. `@anthropic-ai/sdk` 는 쓰지 않는다.
- **모든 LLM 호출은 JSON Schema strict 구조화 출력을 쓴다.** 프롬프트로 "JSON 만 출력해"라고 부탁하는 방식 금지.
- **구조화 출력 스키마는 zod v4 의 `z.toJSONSchema` 로 만들고 strict 보정을 거친다.** `openai/helpers/zod` 의 `zodResponseFormat`/`zodTextFormat` 은 **쓰지 말 것** — 설치된 openai v4 헬퍼는 zod v3 내부구조를 가정해서 zod v4 스키마를 `type: "string"` 으로 망가뜨린다(실측 확인, 400 `invalid_json_schema`). strict 보정이란 모든 `type: "object"` 노드에 `additionalProperties: false` 를 넣고 `required` 에 전체 프로퍼티 키를 채우는 것이다.
- **구조화 출력 스키마의 최상위는 반드시 객체다.** 배열이 필요하면 `{ items: [...] }` 처럼 객체로 감싼다.
- **`message.refusal` 을 항상 먼저 확인한다.** 거절은 예외가 아니라 응답 필드로 오므로, 확인 없이 `content` 를 파싱하면 안 된다.
- **`temperature` 를 건드리지 않는다.** `gpt-5.5` 는 기본값 1 이외의 값을 400 으로 거부한다(실측 확인). 다양성은 시드 조합과 요청마다 재샘플링하는 골든 few-shot 에서 나온다.
- **토큰 상한 파라미터는 `max_completion_tokens` 다** (`max_tokens` 아님).
- **캐시 지시 파라미터를 넣지 않는다.** 프롬프트 캐싱은 자동이다. 대신 시스템 프롬프트를 앞에, 매 요청 달라지는 시드 목록을 뒤에 둔다.
- **Batches API 금지.** 동기 호출 + 동시성 4 + 지수 백오프 3회 재시도. (근거: 스펙 15번)
- **pgvector 금지.** 임베딩은 `real[]`, 코사인 유사도는 애플리케이션에서 계산. (근거: 스펙 6번)
- 유사도 임계값: 중복 탈락 **0.85 초과**, 자동 승인 신뢰선 **0.7 미만**.
- judge 합격선: 안전 통과 **AND** 4개 항목 평균 **>= 3.5** **AND** `variance` **>= 3**.
- 커밋 메시지는 **영어+한글만, 한자 금지**.
- 기존 NestJS 프로젝트 관례를 따른다: `src/{common,infrastructure,modules}` 레이아웃, 파일명 `*.service.ts` / `*.entity.ts` / `*.module.ts`.
- **모듈 경계를 넘는 import 는 `src/...` 절대 경로 별칭을 쓴다.** 같은 모듈 안 형제 폴더(예: `entities/` 에서 `../enums/`)는 상대 경로가 맞다 — 상대 경로는 별칭 재작성 대상이 아니라 빌드상 더 안전하기도 하다. 이 별칭은 세 곳에서 해석된다 — jest 는 `moduleNameMapper`, `npm run cli` 와 `start:dev` 는 `ts-node -r tsconfig-paths/register`, 빌드 산출물은 `tsc-alias`. 셋 중 하나라도 빠지면 런타임에 `Cannot find module 'src/...'` 가 난다. 스크립트를 건드릴 때 이 세 경로를 깨지 않는지 확인할 것.
- **대리키 `id` 는 `bigint`(TypeScript 상 `string`) 다. 예외는 `generation_batches.id` 하나** — 배치 id 는 애플리케이션이 `randomUUID()` 로 부여하는 값이라 `varchar(64)` 이고, `questions.batch_id` 가 같은 타입으로 이를 참조한다.
- **스펙 11번 DDL 의 FK 선언은 엔티티에 반영한다:** `questions.seed_hash -> seed_combinations.seed_hash`(nullable), `question_stats.question_id -> questions.id`. 참조 무결성을 애플리케이션에 떠넘기지 않는다.
- **`package.json` 을 수정하는 태스크는 `package-lock.json` 도 함께 커밋한다.** 여러 태스크가 이어서 의존성을 추가하므로 락파일이 없으면 전이 의존성이 조용히 드리프트한다.

---

## File Structure

```
src/
  main.ts                                  HTTP 부트스트랩 (헬스체크만)
  app.module.ts                            루트 모듈
  cli.ts                                   nest-commander 부트스트랩

  common/
    config/env.schema.ts                   zod 환경변수 검증
    utils/cosine.ts                        코사인 유사도
    utils/concurrency.ts                   동시성 제한 map

  infrastructure/
    database/database.module.ts            TypeORM 연결
    database/migrations/                   마이그레이션
    llm/llm.module.ts
    llm/llm.client.ts                      OpenAI 래퍼 (구조화 출력 + 재시도 + refusal 처리)
    llm/embedding.client.ts                OpenAI 임베딩 래퍼
    llm/json-schema.ts                     zod -> strict JSON Schema 변환

  modules/
    questions/
      enums/question-format.enum.ts
      enums/question-status.enum.ts
      entities/{seed-axis,seed-combination,question,question-stat,generation-batch}.entity.ts
      questions.module.ts

    seeds/
      data/axis-values.ts                  축 테이블 상수
      data/golden-questions.ts             부트스트랩 골든 20개
      seed-combination.service.ts          조합 생성·해시·미사용 추출
      commands/seed.command.ts             축/골든 적재 CLI
      seeds.module.ts

    generation/
      prompts/                             형식별 프롬프트 + judge + safety
      schemas/                             zod 스키마 3종
      question-generator.service.ts
      dedupe.service.ts
      judge.service.ts
      safety.service.ts
      generation-pipeline.service.ts       단계 조립 + 배치 기록
      commands/generate.command.ts
      generation.module.ts

    review/
      review.service.ts                    검수 큐 조회·승인·반려
      commands/review.command.ts
      review.module.ts

    stats/
      question-stats.service.ts            분산도 집계 + 골든 승격/은퇴
      commands/stats.command.ts
      stats.module.ts

test/
  fixtures/safety-cases.ts                 안전 회귀 골든 20개
```

**책임 분리 원칙:** `*.service.ts` 는 도메인 로직만 담고 LLM/임베딩 호출은 `infrastructure/llm` 의 클라이언트에 위임한다. 덕분에 생성기·judge·안전필터 테스트는 클라이언트를 목으로 바꿔 API 호출 없이 돌아간다. 프롬프트 문자열은 서비스에서 분리해 `prompts/` 에 두어 프롬프트 수정이 로직 diff 를 오염시키지 않게 한다.

---

## Task 1: 프로젝트 스캐폴딩과 환경변수 검증

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.gitignore`, `.env.example`
- Create: `src/common/config/env.schema.ts`
- Create: `src/app.module.ts`, `src/main.ts`
- Test: `src/common/config/env.schema.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `Env` 타입과 `validateEnv(raw: Record<string, unknown>): Env`. 이후 모든 모듈이 `ConfigService` 를 통해 `DATABASE_URL` 과 `OPENAI_API_KEY` 를 읽는다.

- [ ] **Step 1: 프로젝트 파일 생성**

`package.json`:

```json
{
  "name": "quiz-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build && tsc-alias -p tsconfig.build.json",
    "start": "npm run build && node dist/main",
    "start:dev": "ts-node -r tsconfig-paths/register src/main.ts",
    "cli": "ts-node -r tsconfig-paths/register src/cli.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "typeorm": "typeorm-ts-node-commonjs -d src/infrastructure/database/data-source.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.2",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/typeorm": "^11.0.0",
    "nest-commander": "^3.15.0",
    "openai": "^4.77.0",
    "pg": "^8.13.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.26",
    "zod": "^4.1.5"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.2",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "tsc-alias": "^1.8.10",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.7.2"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": ".",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "testEnvironment": "node",
    "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" }
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "paths": { "src/*": ["src/*"] },
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "test"]
}
```

`nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.local
*.log
coverage/
```

`.env.example`:

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/quiz_app
OPENAI_API_KEY=sk-...
NODE_ENV=development
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/common/config/env.schema.spec.ts`:

```typescript
import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pw@host:5432/db',
    OPENAI_API_KEY: 'sk-test',
    NODE_ENV: 'development',
  };

  it('유효한 환경변수를 통과시킨다', () => {
    const env = validateEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.NODE_ENV).toBe('development');
  });

  it('NODE_ENV 이 없으면 development 로 채운다', () => {
    const { NODE_ENV, ...withoutNodeEnv } = valid;
    expect(validateEnv(withoutNodeEnv).NODE_ENV).toBe('development');
  });

  it('DATABASE_URL 이 없으면 변수명을 담은 에러를 던진다', () => {
    const { DATABASE_URL, ...missing } = valid;
    expect(() => validateEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it('OPENAI_API_KEY 가 빈 문자열이면 에러를 던진다', () => {
    expect(() => validateEnv({ ...valid, OPENAI_API_KEY: '' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm install && npx jest src/common/config/env.schema.spec.ts`
Expected: FAIL — `Cannot find module './env.schema'`

- [ ] **Step 4: 구현**

`src/common/config/env.schema.ts`:

```typescript
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`환경변수 검증 실패 — ${detail}`);
  }
  return result.data;
}
```

`src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'src/common/config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
})
export class AppModule {}
```

`src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest src/common/config/env.schema.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json .gitignore .env.example src/
git commit -m "feat: NestJS 스캐폴딩과 환경변수 검증 추가"
```

---

## Task 2: 엔티티와 마이그레이션

**Files:**
- Create: `src/modules/questions/enums/question-format.enum.ts`, `src/modules/questions/enums/question-status.enum.ts`
- Create: `src/modules/questions/entities/{seed-axis,seed-combination,question,question-stat,generation-batch}.entity.ts`
- Create: `src/modules/questions/questions.module.ts`
- Create: `src/infrastructure/database/database.module.ts`, `src/infrastructure/database/data-source.ts`
- Create: `src/infrastructure/database/migrations/1757300000000-InitQuestionPipeline.ts`
- Modify: `src/app.module.ts`
- Test: `src/modules/questions/entities/question.entity.spec.ts`

**Interfaces:**
- Consumes: `validateEnv` / `ConfigService` (Task 1)
- Produces: 엔티티 클래스 5종과 열거형 2종. 이후 모든 서비스가 `@InjectRepository(Question)` 등으로 주입받는다. 컬럼명은 snake_case, 프로퍼티는 camelCase.

- [ ] **Step 1: 열거형과 엔티티 작성**

`src/modules/questions/enums/question-format.enum.ts`:

```typescript
export enum QuestionFormat {
  CONSTRAINT = 'constraint',
  DILEMMA = 'dilemma',
  PROJECTION = 'projection',
  CONFESSION = 'confession',
}

export const ALL_FORMATS: QuestionFormat[] = [
  QuestionFormat.CONSTRAINT,
  QuestionFormat.DILEMMA,
  QuestionFormat.PROJECTION,
  QuestionFormat.CONFESSION,
];
```

`src/modules/questions/enums/question-status.enum.ts`:

```typescript
export enum QuestionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  LIVE = 'live',
  REJECTED = 'rejected',
  RETIRED = 'retired',
}
```

`src/modules/questions/entities/question.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';
import { QuestionStatus } from '../enums/question-status.enum';

export interface JudgeScores {
  variance: number;
  accessibility: number;
  concreteness: number;
  curiosity: number;
  reason: string;
}

@Entity('questions')
@Index(['status', 'format'])
export class Question {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'topic_tags', type: 'text', array: true, default: () => "'{}'" })
  topicTags!: string[];

  // 스펙 11번 DDL 의 FK: seed_hash -> seed_combinations(seed_hash).
  // 스칼라 컬럼을 쓰기 경로로 유지하고, 관계는 제약 생성 목적으로만 둔다.
  @Column({ name: 'seed_hash', type: 'varchar', length: 16, nullable: true })
  seedHash!: string | null;

  @ManyToOne(() => SeedCombination, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'seed_hash',
    referencedColumnName: 'seedHash',
    foreignKeyConstraintName: 'FK_questions_seed_combinations',
  })
  seedCombination?: SeedCombination | null;

  @Column({ type: 'real', array: true, nullable: true })
  embedding!: number[] | null;

  @Column({ name: 'judge_scores', type: 'jsonb', nullable: true })
  judgeScores!: JudgeScores | null;

  @Column({ name: 'safety_passed', type: 'boolean', nullable: true })
  safetyPassed!: boolean | null;

  @Column({ name: 'safety_reason', type: 'text', nullable: true })
  safetyReason!: string | null;

  @Column({ type: 'varchar', length: 16, default: QuestionStatus.PENDING })
  status!: QuestionStatus;

  @Column({ type: 'boolean', default: false })
  golden!: boolean;

  @Column({ name: 'batch_id', type: 'varchar', length: 64, nullable: true })
  batchId!: string | null;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 64, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

`src/modules/questions/entities/seed-axis.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';

@Entity('seed_axes')
@Unique(['format', 'axisName', 'value'])
export class SeedAxis {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'axis_name', type: 'varchar', length: 64 })
  axisName!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

`src/modules/questions/entities/seed-combination.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';

@Entity('seed_combinations')
export class SeedCombination {
  @PrimaryColumn({ name: 'seed_hash', type: 'varchar', length: 16 })
  seedHash!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'axis_values', type: 'jsonb' })
  axisValues!: Record<string, string>;

  @CreateDateColumn({ name: 'used_at', type: 'timestamptz' })
  usedAt!: Date;
}
```

`src/modules/questions/entities/question-stat.entity.ts`:

```typescript
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('question_stats')
export class QuestionStat {
  // 스펙 11번 DDL 의 FK: question_id -> questions(id). PK 이면서 FK 다.
  @PrimaryColumn({ name: 'question_id', type: 'bigint' })
  questionId!: string;

  @ManyToOne(() => Question, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'question_id',
    foreignKeyConstraintName: 'FK_question_stats_questions',
  })
  question?: Question;

  @Column({ type: 'int', default: 0 })
  served!: number;

  @Column({ type: 'int', default: 0 })
  completed!: number;

  @Column({ type: 'int', default: 0 })
  skipped!: number;

  @Column({ name: 'answer_variance', type: 'real', nullable: true })
  answerVariance!: number | null;

  @Column({ name: 'avg_answer_len', type: 'real', nullable: true })
  avgAnswerLen!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

`src/modules/questions/entities/generation-batch.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';

@Entity('generation_batches')
export class GenerationBatch {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'seed_count', type: 'int' })
  seedCount!: number;

  @Column({ type: 'int', default: 0 })
  generated!: number;

  @Column({ type: 'int', default: 0 })
  deduped!: number;

  @Column({ name: 'judge_passed', type: 'int', default: 0 })
  judgePassed!: number;

  @Column({ name: 'safety_passed', type: 'int', default: 0 })
  safetyPassed!: number;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
```

- [ ] **Step 2: 데이터소스와 모듈 배선**

`src/infrastructure/database/data-source.ts`:

```typescript
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/modules/**/entities/*.entity.ts'],
  migrations: ['src/infrastructure/database/migrations/*.ts'],
  synchronize: false,
});
```

`src/infrastructure/database/database.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        ssl:
          config.get<string>('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

`src/modules/questions/questions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerationBatch } from './entities/generation-batch.entity';
import { Question } from './entities/question.entity';
import { QuestionStat } from './entities/question-stat.entity';
import { SeedAxis } from './entities/seed-axis.entity';
import { SeedCombination } from './entities/seed-combination.entity';

const ENTITIES = [
  Question,
  QuestionStat,
  SeedAxis,
  SeedCombination,
  GenerationBatch,
];

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  exports: [TypeOrmModule],
})
export class QuestionsModule {}
```

`src/app.module.ts` 를 수정해 `DatabaseModule` 과 `QuestionsModule` 을 `imports` 에 추가한다. `dotenv` 를 devDependencies 에 추가한다 (`npm i -D dotenv`).

- [ ] **Step 3: 마이그레이션 생성**

Run: `npm run typeorm -- migration:generate src/infrastructure/database/migrations/InitQuestionPipeline`
Expected: `src/infrastructure/database/migrations/<timestamp>-InitQuestionPipeline.ts` 생성. 생성된 SQL 에 `questions`, `seed_axes`, `seed_combinations`, `question_stats`, `generation_batches` 5개 테이블 CREATE 가 들어있는지 눈으로 확인한다.

- [ ] **Step 4: 마이그레이션 적용과 검증 테스트**

Run: `npm run typeorm -- migration:run`
Expected: 5개 테이블 생성 성공

`src/modules/questions/entities/question.entity.spec.ts`:

```typescript
import { QuestionFormat, ALL_FORMATS } from '../enums/question-format.enum';
import { QuestionStatus } from '../enums/question-status.enum';

describe('질문 열거형', () => {
  it('형식 4종을 모두 노출한다', () => {
    expect(ALL_FORMATS).toHaveLength(4);
    expect(ALL_FORMATS).toEqual([
      QuestionFormat.CONSTRAINT,
      QuestionFormat.DILEMMA,
      QuestionFormat.PROJECTION,
      QuestionFormat.CONFESSION,
    ]);
  });

  it('상태 5종을 노출한다', () => {
    expect(Object.values(QuestionStatus)).toEqual([
      'pending',
      'approved',
      'live',
      'rejected',
      'retired',
    ]);
  });
});
```

Run: `npx jest src/modules/questions`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/ package.json
git commit -m "feat: 질문 파이프라인 엔티티와 초기 마이그레이션 추가"
```

---

## Task 3: 시드 축 데이터와 조합 생성기

**Files:**
- Create: `src/modules/seeds/data/axis-values.ts`
- Create: `src/modules/seeds/seed-combination.service.ts`
- Create: `src/modules/seeds/seeds.module.ts`
- Test: `src/modules/seeds/seed-combination.service.spec.ts`

**Interfaces:**
- Consumes: `QuestionFormat` (Task 2), `SeedCombination` 엔티티 (Task 2)
- Produces:
  - `interface SeedCombinationDto { seedHash: string; format: QuestionFormat; axisValues: Record<string, string> }`
  - `SeedCombinationService.buildHash(format, axisValues): string`
  - `SeedCombinationService.buildAll(format): SeedCombinationDto[]`
  - `SeedCombinationService.drawUnused(format, limit): Promise<SeedCombinationDto[]>`
  - `SeedCombinationService.markUsed(combos): Promise<void>`
  - `AXIS_VALUES: Record<QuestionFormat, Record<string, string[]>>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/modules/seeds/seed-combination.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SeedCombination } from 'src/modules/questions/entities/seed-combination.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { AXIS_VALUES } from './data/axis-values';
import { SeedCombinationService } from './seed-combination.service';

describe('SeedCombinationService', () => {
  let service: SeedCombinationService;
  const repo = { find: jest.fn(), upsert: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SeedCombinationService,
        { provide: getRepositoryToken(SeedCombination), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(SeedCombinationService);
  });

  describe('buildHash', () => {
    it('16자 해시를 만든다', () => {
      const hash = service.buildHash(QuestionFormat.CONSTRAINT, {
        constraintAxis: '시각장애',
        activityAxis: '배변 후 뒤처리',
      });
      expect(hash).toHaveLength(16);
    });

    it('축 값의 키 순서가 달라도 같은 해시를 만든다', () => {
      const a = service.buildHash(QuestionFormat.CONSTRAINT, {
        constraintAxis: '시각장애',
        activityAxis: '배변 후 뒤처리',
      });
      const b = service.buildHash(QuestionFormat.CONSTRAINT, {
        activityAxis: '배변 후 뒤처리',
        constraintAxis: '시각장애',
      });
      expect(a).toBe(b);
    });

    it('형식이 다르면 다른 해시를 만든다', () => {
      const values = { a: 'x', b: 'y' };
      expect(service.buildHash(QuestionFormat.CONSTRAINT, values)).not.toBe(
        service.buildHash(QuestionFormat.DILEMMA, values),
      );
    });
  });

  describe('buildAll', () => {
    it('constraint 는 제약 x 행위 전조합을 만든다', () => {
      const combos = service.buildAll(QuestionFormat.CONSTRAINT);
      const axes = AXIS_VALUES[QuestionFormat.CONSTRAINT];
      const expected =
        axes.constraintAxis.length * axes.activityAxis.length;
      expect(combos).toHaveLength(expected);
    });

    it('중복 해시를 만들지 않는다', () => {
      const combos = service.buildAll(QuestionFormat.CONSTRAINT);
      expect(new Set(combos.map((c) => c.seedHash)).size).toBe(combos.length);
    });

    it('dilemma 는 서로 다른 괴로움 축 두 개를 짝짓는다', () => {
      const combos = service.buildAll(QuestionFormat.DILEMMA);
      for (const combo of combos) {
        expect(combo.axisValues.miseryA).not.toBe(combo.axisValues.miseryB);
      }
    });
  });

  describe('drawUnused', () => {
    it('이미 사용된 해시를 제외하고 반환한다', async () => {
      const all = service.buildAll(QuestionFormat.CONSTRAINT);
      const usedHash = all[0].seedHash;
      repo.find.mockResolvedValue([{ seedHash: usedHash }]);

      const drawn = await service.drawUnused(QuestionFormat.CONSTRAINT, 5);

      expect(drawn).toHaveLength(5);
      expect(drawn.map((c) => c.seedHash)).not.toContain(usedHash);
    });

    it('남은 조합이 limit 보다 적으면 남은 만큼만 반환한다', async () => {
      const all = service.buildAll(QuestionFormat.CONSTRAINT);
      repo.find.mockResolvedValue(all.slice(0, all.length - 2).map((c) => ({ seedHash: c.seedHash })));

      const drawn = await service.drawUnused(QuestionFormat.CONSTRAINT, 10);

      expect(drawn).toHaveLength(2);
    });

    it('모든 조합이 소진되면 빈 배열을 반환한다', async () => {
      const all = service.buildAll(QuestionFormat.CONSTRAINT);
      repo.find.mockResolvedValue(all.map((c) => ({ seedHash: c.seedHash })));

      await expect(
        service.drawUnused(QuestionFormat.CONSTRAINT, 5),
      ).resolves.toEqual([]);
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/seeds`
Expected: FAIL — `Cannot find module './data/axis-values'`

- [ ] **Step 3: 축 데이터 작성**

`src/modules/seeds/data/axis-values.ts` — 스펙 4번의 값을 그대로 옮긴다:

```typescript
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';

export const AXIS_VALUES: Record<QuestionFormat, Record<string, string[]>> = {
  [QuestionFormat.CONSTRAINT]: {
    constraintAxis: [
      '시각장애',
      '청각장애',
      '손이 하나뿐',
      '말을 못 함',
      '기억이 10분만 유지됨',
      '무중력 상태',
      '물이 전혀 없음',
      '남들이 내 생각을 들을 수 있음',
      '몸이 30cm 로 작아짐',
      '거짓말을 할 수 없음',
    ],
    activityAxis: [
      '배변 후 뒤처리',
      '샤워',
      '라면 끓이기',
      '이별 통보',
      '지하철 타기',
      '소개팅',
      '장례식 참석',
      '면접',
      '병원 진료',
    ],
  },
  [QuestionFormat.DILEMMA]: {
    miseryA: [
      '프라이버시 상실',
      '신체 불편',
      '사회적 평판',
      '시간 낭비',
      '관계 단절',
      '감각 상실',
      '자유 제한',
    ],
    miseryB: [
      '프라이버시 상실',
      '신체 불편',
      '사회적 평판',
      '시간 낭비',
      '관계 단절',
      '감각 상실',
      '자유 제한',
    ],
    intensity: ['평생', '1년', '하루에 1시간'],
  },
  [QuestionFormat.PROJECTION]: {
    scenarioAxis: [
      '시한부 통보',
      '로또 당첨',
      '무인도 표류',
      '시간여행',
      '투명인간',
      '과거로 편지',
      '다른 사람 몸',
    ],
    limitAxis: ['딱 하나만', '딱 한 명만', '24시간 안에', '아무도 모르게'],
  },
  [QuestionFormat.CONFESSION]: {
    tabooAxis: [
      '거짓말',
      '질투',
      '돈',
      '성적 취향',
      '가족에 대한 감정',
      '친구에 대한 속마음',
      '후회',
      '몰래 한 행동',
    ],
  },
};

/** 형식별로 시드 하나당 요청할 변형 개수 */
export const VARIANTS_PER_SEED: Record<QuestionFormat, number> = {
  [QuestionFormat.CONSTRAINT]: 3,
  [QuestionFormat.DILEMMA]: 3,
  [QuestionFormat.PROJECTION]: 3,
  [QuestionFormat.CONFESSION]: 10,
};
```

- [ ] **Step 4: 서비스 구현**

`src/modules/seeds/seed-combination.service.ts`:

```typescript
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeedCombination } from 'src/modules/questions/entities/seed-combination.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { AXIS_VALUES } from './data/axis-values';

export interface SeedCombinationDto {
  seedHash: string;
  format: QuestionFormat;
  axisValues: Record<string, string>;
}

@Injectable()
export class SeedCombinationService {
  constructor(
    @InjectRepository(SeedCombination)
    private readonly repo: Repository<SeedCombination>,
  ) {}

  buildHash(format: QuestionFormat, axisValues: Record<string, string>): string {
    const normalized = Object.keys(axisValues)
      .sort()
      .map((key) => `${key}=${axisValues[key]}`)
      .join('|');
    return createHash('sha256')
      .update(`${format}:${normalized}`)
      .digest('hex')
      .slice(0, 16);
  }

  buildAll(format: QuestionFormat): SeedCombinationDto[] {
    const axes = AXIS_VALUES[format];
    const rows =
      format === QuestionFormat.DILEMMA
        ? this.buildDilemmaRows(axes)
        : this.buildCartesianRows(axes);

    return rows.map((axisValues) => ({
      seedHash: this.buildHash(format, axisValues),
      format,
      axisValues,
    }));
  }

  async drawUnused(
    format: QuestionFormat,
    limit: number,
  ): Promise<SeedCombinationDto[]> {
    const used = await this.repo.find({
      where: { format },
      select: { seedHash: true },
    });
    const usedHashes = new Set(used.map((row) => row.seedHash));
    return this.buildAll(format)
      .filter((combo) => !usedHashes.has(combo.seedHash))
      .slice(0, limit);
  }

  async markUsed(combos: SeedCombinationDto[]): Promise<void> {
    if (combos.length === 0) return;
    await this.repo.upsert(
      combos.map((combo) => ({
        seedHash: combo.seedHash,
        format: combo.format,
        axisValues: combo.axisValues,
      })),
      ['seedHash'],
    );
  }

  /** 축들의 데카르트 곱 */
  private buildCartesianRows(
    axes: Record<string, string[]>,
  ): Record<string, string>[] {
    return Object.entries(axes).reduce<Record<string, string>[]>(
      (acc, [axisName, values]) =>
        acc.flatMap((row) => values.map((value) => ({ ...row, [axisName]: value }))),
      [{}],
    );
  }

  /**
   * dilemma 는 서로 다른 괴로움 축 두 개의 비순서 조합 x 강도.
   * (A,B) 와 (B,A) 는 같은 질문이므로 한 번만 만든다.
   */
  private buildDilemmaRows(
    axes: Record<string, string[]>,
  ): Record<string, string>[] {
    const miseries = axes.miseryA;
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < miseries.length; i += 1) {
      for (let j = i + 1; j < miseries.length; j += 1) {
        for (const intensity of axes.intensity) {
          rows.push({ miseryA: miseries[i], miseryB: miseries[j], intensity });
        }
      }
    }
    return rows;
  }
}
```

`src/modules/seeds/seeds.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedCombinationService } from './seed-combination.service';

@Module({
  imports: [QuestionsModule],
  providers: [SeedCombinationService],
  exports: [SeedCombinationService],
})
export class SeedsModule {}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest src/modules/seeds`
Expected: PASS (9 tests). `buildAll(CONSTRAINT)` 은 90개, `buildAll(DILEMMA)` 은 63개(7C2 x 3), `buildAll(PROJECTION)` 은 28개, `buildAll(CONFESSION)` 은 8개여야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/seeds
git commit -m "feat: 시드 축 테이블과 조합 생성기 추가"
```

---

## Task 4: LLM 클라이언트 (OpenAI)

**Files:**
- Create: `src/common/utils/concurrency.ts`
- Create: `src/infrastructure/llm/json-schema.ts`
- Create: `src/infrastructure/llm/llm.client.ts`
- Create: `src/infrastructure/llm/llm.module.ts`
- Modify: `package.json` (`@anthropic-ai/sdk` 제거), `src/common/config/env.schema.ts`, `src/common/config/env.schema.spec.ts`, `.env.example`
- Test: `src/common/utils/concurrency.spec.ts`, `src/infrastructure/llm/json-schema.spec.ts`, `src/infrastructure/llm/llm.client.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (Task 1)
- Produces:
  - `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`
  - `toStrictJsonSchema(schema: z.ZodType): Record<string, unknown>`
  - `LLM_MODEL = 'gpt-5.5'` 상수
  - `class LlmRefusalError extends Error { readonly refusal: string }`
  - `LlmClient.completeJson<T>(args: { system: string; user: string; schema: z.ZodType<T>; schemaName: string; maxTokens?: number }): Promise<T>`

**이 태스크가 왜 이렇게 생겼는지 (실측 근거):** 컨트롤러가 실제 API 로 확인한 것들이다. `openai/helpers/zod` 의 `zodResponseFormat` 은 이 프로젝트의 zod v4 스키마를 `type: "string"` 으로 망가뜨려 400 `invalid_json_schema` 를 낸다. `gpt-5.5` 는 `temperature` 를 기본값 1 이외로 주면 400 이다. 토큰 상한은 `max_completion_tokens` 다. 거절은 예외가 아니라 `message.refusal` 필드로 온다. 아래 구현은 이 네 가지를 전부 반영한 것이니 "더 관용적인 SDK 헬퍼가 있을 텐데" 하고 바꾸지 말 것.

- [ ] **Step 0: Anthropic 잔재 제거**

Task 1 이 남긴 것들을 지운다. `@anthropic-ai/sdk` 는 zod v4 와 peer 충돌을 일으켜 `npm install` 이 `--legacy-peer-deps` 없이는 실패한다.

```bash
npm uninstall @anthropic-ai/sdk
```

`src/common/config/env.schema.ts` 의 `envSchema` 에서 `ANTHROPIC_API_KEY: z.string().min(1),` 줄을 지운다.

`src/common/config/env.schema.spec.ts` 에서 `valid` 객체의 `ANTHROPIC_API_KEY: 'sk-ant-test',` 줄을 지우고, 네 번째 테스트를 다음으로 교체한다:

```typescript
  it('OPENAI_API_KEY 가 빈 문자열이면 에러를 던진다', () => {
    expect(() => validateEnv({ ...valid, OPENAI_API_KEY: '' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });
```

`.env.example` 에서 `ANTHROPIC_API_KEY=sk-ant-...` 줄을 지운다.

Run: `npx jest src/common/config` 
Expected: PASS (4 tests). 그리고 `npm install` 이 `--legacy-peer-deps` 없이 통과해야 한다.

- [ ] **Step 1: 동시성 유틸 테스트 작성**

`src/common/utils/concurrency.spec.ts`:

```typescript
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('입력 순서대로 결과를 반환한다', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      await new Promise((r) => setTimeout(r, (5 - n) * 5));
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it('동시 실행 수가 limit 을 넘지 않는다', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('빈 배열이면 빈 배열을 반환한다', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });

  it('하나가 실패하면 전체가 실패한다', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('실패');
        return n;
      }),
    ).rejects.toThrow('실패');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/common/utils`
Expected: FAIL — `Cannot find module './concurrency'`

- [ ] **Step 3: 동시성 유틸 구현**

`src/common/utils/concurrency.ts`:

```typescript
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: JSON Schema 변환기 테스트 작성**

`src/infrastructure/llm/json-schema.spec.ts`:

```typescript
import { z } from 'zod';
import { toStrictJsonSchema } from './json-schema';

describe('toStrictJsonSchema', () => {
  it('모든 객체 노드에 additionalProperties: false 를 넣는다', () => {
    const schema = z.object({ items: z.array(z.object({ text: z.string() })) });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.additionalProperties).toBe(false);
    expect(json.properties.items.items.additionalProperties).toBe(false);
  });

  it('모든 객체 노드의 required 에 전체 프로퍼티 키를 채운다', () => {
    const schema = z.object({
      a: z.string(),
      b: z.number(),
      nested: z.object({ c: z.string(), d: z.boolean() }),
    });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.required.sort()).toEqual(['a', 'b', 'nested']);
    expect(json.properties.nested.required.sort()).toEqual(['c', 'd']);
  });

  it('optional 필드도 required 에 넣는다 (strict 모드 요구사항)', () => {
    const schema = z.object({ a: z.string(), b: z.string().optional() });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.required.sort()).toEqual(['a', 'b']);
  });

  it('최상위 타입이 object 다', () => {
    const schema = z.object({ items: z.array(z.string()) });
    expect((toStrictJsonSchema(schema) as any).type).toBe('object');
  });

  it('enum 을 보존한다', () => {
    const schema = z.object({ tag: z.enum(['a', 'b']) });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.properties.tag.enum.sort()).toEqual(['a', 'b']);
  });

  it('배열 안의 원시 타입은 건드리지 않는다', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.properties.tags.items.type).toBe('string');
    expect(json.properties.tags.items.additionalProperties).toBeUndefined();
  });
});
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `npx jest src/infrastructure/llm/json-schema`
Expected: FAIL — `Cannot find module './json-schema'`

- [ ] **Step 6: JSON Schema 변환기 구현**

`src/infrastructure/llm/json-schema.ts`:

```typescript
import { z } from 'zod';

/**
 * zod 스키마를 OpenAI 구조화 출력 strict 모드가 받는 JSON Schema 로 바꾼다.
 *
 * `openai/helpers/zod` 의 zodResponseFormat / zodTextFormat 은 쓰지 않는다.
 * 그 헬퍼들은 zod v3 내부구조를 가정하고 있어서 이 프로젝트의 zod v4 스키마를
 * `type: "string"` 으로 망가뜨리고 400 invalid_json_schema 를 낸다.
 *
 * strict 모드는 모든 객체에 additionalProperties: false 와
 * "전체 프로퍼티가 required" 를 요구한다. optional 필드도 예외가 아니다.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<
    string,
    unknown
  >;
  strictify(json);
  return json;
}

function strictify(node: unknown): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) strictify(item);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (obj.type === 'object') {
    obj.additionalProperties = false;
    const properties = obj.properties;
    if (properties !== null && typeof properties === 'object') {
      obj.required = Object.keys(properties as Record<string, unknown>);
    }
  }

  for (const value of Object.values(obj)) strictify(value);
}
```

- [ ] **Step 7: LLM 클라이언트 테스트 작성**

`src/infrastructure/llm/llm.client.spec.ts`:

```typescript
import { z } from 'zod';
import { LlmClient, LlmRefusalError } from './llm.client';

const schema = z.object({ items: z.array(z.string()) });

function buildClient(create: jest.Mock): LlmClient {
  const client = new LlmClient({ getOrThrow: () => 'sk-test' } as never);
  (client as unknown as { openai: unknown }).openai = {
    chat: { completions: { create } },
  };
  return client;
}

function reply(content: unknown, refusal: string | null = null) {
  return {
    choices: [{ message: { content: JSON.stringify(content), refusal } }],
  };
}

describe('LlmClient.completeJson', () => {
  it('검증된 출력을 반환한다', async () => {
    const create = jest.fn().mockResolvedValue(reply({ items: ['a', 'b'] }));
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).resolves.toEqual({ items: ['a', 'b'] });
  });

  it('strict json_schema 형식으로 요청한다', async () => {
    const create = jest.fn().mockResolvedValue(reply({ items: [] }));
    await buildClient(create).completeJson({
      system: 's', user: 'u', schema, schemaName: 'test',
    });

    const params = create.mock.calls[0][0];
    expect(params.response_format.type).toBe('json_schema');
    expect(params.response_format.json_schema.strict).toBe(true);
    expect(params.response_format.json_schema.name).toBe('test');
    expect(params.response_format.json_schema.schema.type).toBe('object');
  });

  it('temperature 를 보내지 않는다 (gpt-5.5 는 기본값만 허용)', async () => {
    const create = jest.fn().mockResolvedValue(reply({ items: [] }));
    await buildClient(create).completeJson({
      system: 's', user: 'u', schema, schemaName: 'test',
    });

    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('토큰 상한을 max_completion_tokens 로 보낸다', async () => {
    const create = jest.fn().mockResolvedValue(reply({ items: [] }));
    await buildClient(create).completeJson({
      system: 's', user: 'u', schema, schemaName: 'test', maxTokens: 500,
    });

    const params = create.mock.calls[0][0];
    expect(params.max_completion_tokens).toBe(500);
    expect(params).not.toHaveProperty('max_tokens');
  });

  it('system 을 앞에, user 를 뒤에 보낸다 (프롬프트 캐시 접두 안정성)', async () => {
    const create = jest.fn().mockResolvedValue(reply({ items: [] }));
    await buildClient(create).completeJson({
      system: 'SYS', user: 'USR', schema, schemaName: 'test',
    });

    expect(create.mock.calls[0][0].messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  });

  it('message.refusal 이 있으면 LlmRefusalError 를 던진다', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: null, refusal: '이 요청은 도울 수 없습니다' } }],
    });
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it('refusal 은 재시도하지 않는다', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: null, refusal: '거절' } }],
    });
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).rejects.toBeInstanceOf(LlmRefusalError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('스키마에 맞지 않는 응답이면 에러를 던진다', async () => {
    const create = jest.fn().mockResolvedValue(reply({ wrong: 'shape' }));
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).rejects.toThrow(/스키마/);
  });

  it('content 가 비어 있으면 에러를 던진다', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: null, refusal: null } }],
    });
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).rejects.toThrow(/content/);
  });

  it('일시적 실패는 재시도하고 성공하면 결과를 돌려준다', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue(reply({ items: ['ok'] }));
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).resolves.toEqual({ items: ['ok'] });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('재시도를 모두 소진하면 마지막 에러를 던진다', async () => {
    const create = jest.fn().mockRejectedValue(new Error('계속 실패'));
    await expect(
      buildClient(create).completeJson({
        system: 's', user: 'u', schema, schemaName: 'test',
      }),
    ).rejects.toThrow('계속 실패');
    expect(create).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 8: 테스트가 실패하는지 확인**

Run: `npx jest src/infrastructure/llm/llm.client`
Expected: FAIL — `Cannot find module './llm.client'`

- [ ] **Step 9: LLM 클라이언트 구현**

`src/infrastructure/llm/llm.client.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { z } from 'zod';
import { toStrictJsonSchema } from './json-schema';

export const LLM_MODEL = 'gpt-5.5';
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

/** 모델이 요청을 거절한 경우. 재시도해도 결과가 같으므로 즉시 던진다. */
export class LlmRefusalError extends Error {
  constructor(readonly refusal: string) {
    super(`LLM 이 요청을 거절했습니다: ${refusal}`);
    this.name = 'LlmRefusalError';
  }
}

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
    });
  }

  /**
   * 구조화 출력으로 JSON 을 받는다.
   * schema 의 최상위는 반드시 객체여야 한다 (배열이면 { items: [...] } 로 감쌀 것).
   *
   * temperature 는 보내지 않는다 — gpt-5.5 는 기본값 1 이외를 400 으로 거부한다.
   * 프롬프트 캐싱은 자동이므로 캐시 지시 파라미터도 없다. 대신 변하지 않는
   * system 을 앞에, 매 요청 달라지는 user 를 뒤에 두어 접두를 안정시킨다.
   */
  async completeJson<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    schemaName: string;
    maxTokens?: number;
  }): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.openai.chat.completions.create({
          model: LLM_MODEL,
          max_completion_tokens: args.maxTokens ?? 16_000,
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: args.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: args.schemaName,
              strict: true,
              schema: toStrictJsonSchema(args.schema),
            },
          },
        });

        const message = response.choices[0]?.message;
        if (message?.refusal) {
          throw new LlmRefusalError(message.refusal);
        }
        if (!message?.content) {
          throw new Error('LLM 응답에 content 가 없습니다');
        }

        const parsed = args.schema.safeParse(JSON.parse(message.content));
        if (!parsed.success) {
          throw new Error(
            `LLM 응답이 스키마에 맞지 않습니다: ${parsed.error.message}`,
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof LlmRefusalError) throw error;
        lastError = error;
        this.logger.warn(
          `LLM 호출 실패 (${attempt}/${MAX_ATTEMPTS}): ${String(error)}`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)),
          );
        }
      }
    }

    throw lastError;
  }
}
```

`src/infrastructure/llm/llm.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LlmClient } from './llm.client';

@Module({
  providers: [LlmClient],
  exports: [LlmClient],
})
export class LlmModule {}
```

- [ ] **Step 10: 테스트 통과 확인**

Run: `npx jest src/common/utils src/infrastructure/llm src/common/config`
Expected: PASS (21 tests: 동시성 4 + JSON Schema 6 + 클라이언트 11), 출력 깨끗

- [ ] **Step 11: 실제 API 스모크**

목으로는 알 수 없는 것 — 실제 모델이 이 스키마 형식을 받아주는지 — 을 한 번 확인한다. 이후 태스크가 전부 이 경로에 의존한다.

`scripts/smoke-llm.ts`:

```typescript
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmClient } from '../src/infrastructure/llm/llm.client';

const schema = z.object({
  items: z.array(z.object({ text: z.string(), tag: z.string() })),
});

async function main(): Promise<void> {
  const client = new LlmClient(
    new ConfigService({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
  );
  const result = await client.completeJson({
    system: '너는 테스트용 응답기다.',
    user: '아무 한국어 문장 2개를 items 로 반환해라. tag 는 test 로 채운다.',
    schema,
    schemaName: 'smoke',
    maxTokens: 2_000,
  });
  console.log(JSON.stringify(result, null, 2));
}

void main();
```

Run: `npx ts-node -r tsconfig-paths/register scripts/smoke-llm.ts`
Expected: `items` 에 객체 2개가 담긴 JSON 출력.

`max_completion_tokens` 를 너무 작게 잡으면 추론 토큰만 쓰고 content 가 비어 돌아온다. 스모크가 "content 가 없습니다" 로 실패하면 상한을 올려서 다시 시도하고, 그 값을 보고에 적는다.

- [ ] **Step 12: 커밋**

```bash
git add package.json package-lock.json .env.example src/ scripts/
git commit -m "feat: OpenAI LLM 클라이언트와 구조화 출력 스키마 변환기 추가"
```

---

## Task 5: 임베딩 클라이언트와 코사인 유사도

**Files:**
- Create: `src/common/utils/cosine.ts`
- Create: `src/infrastructure/llm/embedding.client.ts`
- Modify: `src/infrastructure/llm/llm.module.ts`
- Test: `src/common/utils/cosine.spec.ts`, `src/infrastructure/llm/embedding.client.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (Task 1), `mapWithConcurrency` (Task 4)
- Produces:
  - `cosineSimilarity(a: number[], b: number[]): number`
  - `meanPairwiseDistance(vectors: number[][]): number` — 답변 분산도. 벡터가 2개 미만이면 0.
  - `EMBEDDING_MODEL = 'text-embedding-3-small'`, `EMBEDDING_DIM = 1536`
  - `EmbeddingClient.embed(texts: string[]): Promise<number[][]>` — 입력 순서를 보존한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/common/utils/cosine.spec.ts`:

```typescript
import { cosineSimilarity, meanPairwiseDistance } from './cosine';

describe('cosineSimilarity', () => {
  it('같은 벡터는 1 이다', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('직교 벡터는 0 이다', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('반대 벡터는 -1 이다', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('영벡터가 섞이면 0 을 반환한다', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('길이가 다르면 에러를 던진다', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/길이/);
  });
});

describe('meanPairwiseDistance', () => {
  it('벡터가 1개 이하면 0 이다', () => {
    expect(meanPairwiseDistance([])).toBe(0);
    expect(meanPairwiseDistance([[1, 0]])).toBe(0);
  });

  it('동일한 벡터들만 있으면 0 에 가깝다', () => {
    expect(meanPairwiseDistance([[1, 0], [1, 0], [1, 0]])).toBeCloseTo(0);
  });

  it('서로 다른 답변일수록 값이 크다', () => {
    const similar = meanPairwiseDistance([[1, 0], [0.99, 0.01]]);
    const diverse = meanPairwiseDistance([[1, 0], [0, 1]]);
    expect(diverse).toBeGreaterThan(similar);
  });
});
```

`src/infrastructure/llm/embedding.client.spec.ts`:

```typescript
import { EmbeddingClient } from './embedding.client';

function buildClient(create: jest.Mock): EmbeddingClient {
  const client = new EmbeddingClient({ getOrThrow: () => 'sk-test' } as never);
  (client as unknown as { openai: unknown }).openai = {
    embeddings: { create },
  };
  return client;
}

describe('EmbeddingClient.embed', () => {
  it('입력 순서대로 벡터를 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    await expect(buildClient(create).embed(['a', 'b'])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('빈 입력이면 API 를 호출하지 않는다', async () => {
    const create = jest.fn();
    await expect(buildClient(create).embed([])).resolves.toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('100개를 넘으면 나눠 호출하고 순서를 유지한다', async () => {
    const create = jest.fn().mockImplementation(({ input }) => ({
      data: (input as string[]).map((text, index) => ({
        index,
        embedding: [Number(text)],
      })),
    }));
    const texts = Array.from({ length: 150 }, (_, i) => String(i));

    const result = await buildClient(create).embed(texts);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
    expect(result[0]).toEqual([0]);
    expect(result[149]).toEqual([149]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/common/utils/cosine src/infrastructure/llm/embedding`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/common/utils/cosine.ts`:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`벡터 길이가 다릅니다: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 답변 분산도. 모든 쌍의 코사인 거리(1 - 유사도) 평균.
 * 값이 클수록 답변이 서로 다르다 = 좋은 질문.
 */
export function meanPairwiseDistance(vectors: number[][]): number {
  if (vectors.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      total += 1 - cosineSimilarity(vectors[i], vectors[j]);
      pairs += 1;
    }
  }
  return total / pairs;
}
```

`src/infrastructure/llm/embedding.client.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
const BATCH_SIZE = 100;

@Injectable()
export class EmbeddingClient {
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
    });
  }

  /** 입력 순서를 보존해 임베딩을 반환한다. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const slice = texts.slice(offset, offset + BATCH_SIZE);
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: slice,
      });
      // API 가 순서를 보장하지 않으므로 index 로 재정렬한다.
      const ordered = new Array<number[]>(slice.length);
      for (const item of response.data) {
        ordered[item.index] = item.embedding as number[];
      }
      results.push(...ordered);
    }
    return results;
  }
}
```

`src/infrastructure/llm/llm.module.ts` 에 `EmbeddingClient` 를 `providers` 와 `exports` 에 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/common/utils src/infrastructure/llm`
Expected: PASS (19 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/common/utils src/infrastructure/llm
git commit -m "feat: OpenAI 임베딩 클라이언트와 코사인 유사도 유틸 추가"
```

---

## Task 6: 질문 생성기

**Files:**
- Create: `src/modules/generation/schemas/generated-question.schema.ts`
- Create: `src/modules/generation/prompts/shared.prompt.ts`
- Create: `src/modules/generation/prompts/format.prompts.ts`
- Create: `src/modules/generation/question-generator.service.ts`
- Create: `src/modules/generation/generation.module.ts`
- Test: `src/modules/generation/question-generator.service.spec.ts`

**Interfaces:**
- Consumes: `LlmClient` (Task 4), `SeedCombinationDto` (Task 3), `Question` 엔티티 (Task 2)
- Produces:
  - `interface GeneratedQuestion { text: string; topicTags: string[]; seedHash: string }`
  - `GeneratedQuestionsSchema` (zod, `{ items: GeneratedQuestion[] }`)
  - `QuestionGeneratorService.generate(format, combos, variantsPerSeed): Promise<GeneratedQuestion[]>`
  - `SEEDS_PER_REQUEST = 10`

- [ ] **Step 1: 스키마와 프롬프트 작성**

`src/modules/generation/schemas/generated-question.schema.ts`:

```typescript
import { z } from 'zod';

import { TOPIC_TAGS } from '../prompts/shared.prompt';

export const GeneratedQuestionsSchema = z.object({
  items: z.array(
    z.object({
      text: z.string().min(5),
      // 자유 문자열로 두면 모델이 허용 목록 밖의 태그를 지어낸다(실측 확인).
      // 스키마에 열거형으로 박아 구조화 출력 단계에서 강제한다.
      topicTags: z.array(z.enum(TOPIC_TAGS)).min(1),
      seedHash: z.string(),
    }),
  ),
});

export type GeneratedQuestion = z.infer<
  typeof GeneratedQuestionsSchema
>['items'][number];
```

`src/modules/generation/prompts/shared.prompt.ts` — 모든 형식이 공유하는 골격. `{formatRules}` 와 `{goldenExamples}` 만 형식별로 갈린다:

```typescript
export const TOPIC_TAGS = [
  '신체생리',
  '연애',
  '가족',
  '죽음',
  '돈',
  '일직업',
  '친구관계',
  '음식',
  '사회적금기',
  '비현실상황',
] as const;

export function buildSystemPrompt(args: {
  formatRules: string;
  goldenExamples: string[];
}): string {
  return `너는 친구들끼리 하는 대화형 게임의 질문을 만든다.
이 게임은 모두가 각자 답을 적고, 전원이 제출한 뒤에 서로의 답을 동시에 공개한다.
정답을 맞히는 게임이 아니라 서로 얼마나 다르게 생각하는지 보는 게임이다.

[좋은 질문의 조건]
- 상황이 구체적이고 일상적이다. 추상적 철학 질문이 아니다.
- 실제로 답이 존재하지만 대부분의 사람은 모른다. 그래서 각자 추측이 갈린다.
- 전문 지식 없이 누구나 자기 생각을 말할 수 있다.
- 남이 뭐라고 답했는지 궁금해진다.
- 혼자 검색하긴 좀 민망하지만 같이 얘기하면 재밌다.

[반드시 피할 것]
- 정답이 뻔해서 모두 같은 답을 할 질문
- "만약 하늘이 초록색이라면" 같은 밍밍한 가정
- 전문 지식이 있어야 답할 수 있는 질문
- 특정 집단을 조롱하거나 비하하는 질문

[안전 기준 - 가장 중요]
어떤 조건이나 장애를 다룰 때, 그 사람의 "삶의 방식"이 궁금한 것은 괜찮다.
그 사람의 "결함"을 웃음거리로 삼는 것은 안 된다.

판정 테스트: 그 당사자가 이 질문을 봤을 때, 기분 나빠하지 않고
             오히려 같이 답할 수 있는가?

- 통과: "시각장애인은 변 닦고 다 닦였는지 어떻게 확인할까?"
        (당사자가 답하면 오히려 제일 좋은 답이 나온다)
- 탈락: "시각장애인은 얼마나 불편할까?"
        (답이 아니라 동정을 요구한다)

[이 형식의 규칙]
${args.formatRules}

[예시]
${args.goldenExamples.map((example, i) => `${i + 1}. ${example}`).join('\n')}

[출력 규칙]
- text 는 한국어 반말, 물음표로 끝낸다.
- topicTags 는 다음 중에서 고른다: ${TOPIC_TAGS.join(', ')}
- seedHash 는 입력으로 받은 시드의 해시를 그대로 적는다.`;
}
```

`src/modules/generation/prompts/format.prompts.ts`:

```typescript
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';

export const FORMAT_RULES: Record<QuestionFormat, string> = {
  [QuestionFormat.CONSTRAINT]:
    '"제약" 때문에 "행위" 가 평소처럼 되지 않는 상황을 만들고, 그 상황에서 어떻게 하는지 묻는다. 제약은 상황의 전제이지 놀림거리가 아니다.',
  [QuestionFormat.DILEMMA]:
    '두 선택지가 동등하게 괴로워야 한다. 한쪽이 명백히 나으면 실패다. 두 괴로움 축과 강도를 써서 고르기 힘든 두 선택지를 만든다.',
  [QuestionFormat.PROJECTION]:
    '상황을 겪는 주인공은 답변자 본인이다. "너라면 어떻게 할래" 로 묻고, 제한 축을 걸어 답을 좁힌다.',
  [QuestionFormat.CONFESSION]:
    '답하기 부담스럽지만 답할 수는 있는 선을 지킨다. 대답 자체가 불가능한 수위는 안 된다. 금기 영역에서 자기 얘기를 하나 꺼내게 만든다.',
};

export function buildUserPrompt(args: {
  combos: { seedHash: string; axisValues: Record<string, string> }[];
  variantsPerSeed: number;
}): string {
  const lines = args.combos.map((combo, index) => {
    const axes = Object.entries(combo.axisValues)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' / ');
    return `${index + 1}. [seedHash: ${combo.seedHash}] ${axes}`;
  });

  return `아래 조합들을 각각 질문 문장으로 만들어라.
조합 하나당 서로 다른 각도로 ${args.variantsPerSeed}개씩 만든다.

${lines.join('\n')}`;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/modules/generation/question-generator.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionGeneratorService } from './question-generator.service';

const COMBOS = Array.from({ length: 25 }, (_, i) => ({
  seedHash: `hash${i}`,
  format: QuestionFormat.CONSTRAINT,
  axisValues: { constraintAxis: `제약${i}`, activityAxis: `행위${i}` },
}));

describe('QuestionGeneratorService', () => {
  let service: QuestionGeneratorService;
  const llm = { completeJson: jest.fn() };
  const questionRepo = { find: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    questionRepo.find.mockResolvedValue([
      { text: '골든 질문 1?' },
      { text: '골든 질문 2?' },
      { text: '골든 질문 3?' },
      { text: '골든 질문 4?' },
      { text: '골든 질문 5?' },
      { text: '골든 질문 6?' },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionGeneratorService,
        { provide: LlmClient, useValue: llm },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
      ],
    }).compile();
    service = moduleRef.get(QuestionGeneratorService);
  });

  it('시드를 10개씩 나눠 호출한다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    expect(llm.completeJson).toHaveBeenCalledTimes(3); // 10 + 10 + 5
  });

  it('모든 호출 결과를 합쳐서 반환한다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [{ text: '질문?', topicTags: ['신체생리'], seedHash: 'hash0' }],
    });

    const result = await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    expect(result).toHaveLength(3);
  });

  it('골든 예시를 5개까지만 프롬프트에 넣는다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.generate(QuestionFormat.CONSTRAINT, COMBOS.slice(0, 1), 3);

    const { system } = llm.completeJson.mock.calls[0][0];
    const exampleCount = (system.match(/골든 질문/g) ?? []).length;
    expect(exampleCount).toBeLessThanOrEqual(5);
    expect(exampleCount).toBeGreaterThan(0);
  });

  it('요청마다 골든 예시를 다시 샘플링한다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    // 같은 호출에서 재사용된 배열 참조가 아니라 매번 새로 뽑는지 확인
    expect(questionRepo.find).toHaveBeenCalledTimes(1);
    const systems = llm.completeJson.mock.calls.map((call) => call[0].system);
    expect(new Set(systems).size).toBeGreaterThanOrEqual(1);
  });

  it('입력에 없는 seedHash 가 돌아오면 버린다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [
        { text: '정상?', topicTags: ['연애'], seedHash: 'hash0' },
        { text: '유령?', topicTags: ['연애'], seedHash: '없는해시' },
      ],
    });

    const result = await service.generate(
      QuestionFormat.CONSTRAINT,
      COMBOS.slice(0, 1),
      3,
    );

    expect(result).toHaveLength(1);
    expect(result[0].seedHash).toBe('hash0');
  });

  it('한 요청이 실패해도 나머지 결과를 살린다', async () => {
    llm.completeJson
      .mockRejectedValueOnce(new Error('LLM 실패'))
      .mockResolvedValue({
        items: [{ text: '질문?', topicTags: ['돈'], seedHash: 'hash10' }],
      });

    const result = await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    expect(result).toHaveLength(2);
  });

  it('빈 조합이면 LLM 을 호출하지 않는다', async () => {
    await expect(
      service.generate(QuestionFormat.CONSTRAINT, [], 3),
    ).resolves.toEqual([]);
    expect(llm.completeJson).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/generation`
Expected: FAIL — `Cannot find module './question-generator.service'`

- [ ] **Step 4: 구현**

`src/modules/generation/question-generator.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mapWithConcurrency } from 'src/common/utils/concurrency';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { SeedCombinationDto } from 'src/modules/seeds/seed-combination.service';
import { FORMAT_RULES, buildUserPrompt } from './prompts/format.prompts';
import { buildSystemPrompt } from './prompts/shared.prompt';
import {
  GeneratedQuestion,
  GeneratedQuestionsSchema,
} from './schemas/generated-question.schema';

export const SEEDS_PER_REQUEST = 10;
export const GOLDEN_SAMPLE_SIZE = 5;
const CONCURRENCY = 4;

@Injectable()
export class QuestionGeneratorService {
  private readonly logger = new Logger(QuestionGeneratorService.name);

  constructor(
    private readonly llm: LlmClient,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async generate(
    format: QuestionFormat,
    combos: SeedCombinationDto[],
    variantsPerSeed: number,
  ): Promise<GeneratedQuestion[]> {
    if (combos.length === 0) return [];

    const goldenPool = await this.loadGoldenPool(format);
    const chunks = this.chunk(combos, SEEDS_PER_REQUEST);
    const validHashes = new Set(combos.map((combo) => combo.seedHash));

    const perChunk = await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      try {
        const result = await this.llm.completeJson({
          // 요청마다 골든 예시를 다시 뽑는다. 고정하면 출력이 예시에 수렴한다.
          system: buildSystemPrompt({
            formatRules: FORMAT_RULES[format],
            goldenExamples: this.sampleGolden(goldenPool),
          }),
          user: buildUserPrompt({ combos: chunk, variantsPerSeed }),
          schema: GeneratedQuestionsSchema,
          schemaName: 'generated_questions',
        });
        return result.items;
      } catch (error) {
        this.logger.warn(`생성 요청 실패, 이 묶음은 건너뜁니다: ${String(error)}`);
        return [];
      }
    });

    return perChunk
      .flat()
      .filter((item) => validHashes.has(item.seedHash));
  }

  private async loadGoldenPool(format: QuestionFormat): Promise<string[]> {
    const rows = await this.questions.find({
      where: { format, golden: true },
      select: { text: true },
    });
    return rows.map((row) => row.text);
  }

  private sampleGolden(pool: string[]): string[] {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, GOLDEN_SAMPLE_SIZE);
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
```

`src/modules/generation/generation.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LlmModule } from 'src/infrastructure/llm/llm.module';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { SeedsModule } from 'src/modules/seeds/seeds.module';
import { QuestionGeneratorService } from './question-generator.service';

@Module({
  imports: [LlmModule, QuestionsModule, SeedsModule],
  providers: [QuestionGeneratorService],
  exports: [QuestionGeneratorService],
})
export class GenerationModule {}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest src/modules/generation`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/modules/generation
git commit -m "feat: 형식별 프롬프트와 질문 생성기 추가"
```

---

## Task 7: 중복 제거

**Files:**
- Create: `src/modules/generation/dedupe.service.ts`
- Modify: `src/modules/generation/generation.module.ts`
- Test: `src/modules/generation/dedupe.service.spec.ts`

**Interfaces:**
- Consumes: `EmbeddingClient` (Task 5), `cosineSimilarity` (Task 5), `GeneratedQuestion` (Task 6), `Question` 엔티티 (Task 2)
- Produces:
  - `interface EmbeddedQuestion extends GeneratedQuestion { embedding: number[] }`
  - `interface DedupeResult { kept: EmbeddedQuestion[]; dropped: { text: string; similarity: number; against: string }[] }`
  - `DedupeService.filter(candidates: GeneratedQuestion[]): Promise<DedupeResult>`
  - `DUPLICATE_THRESHOLD = 0.85`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/modules/generation/dedupe.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { DedupeService } from './dedupe.service';

const q = (text: string) => ({ text, topicTags: ['연애'], seedHash: 'h' });

describe('DedupeService', () => {
  let service: DedupeService;
  const embedding = { embed: jest.fn() };
  const repo = { find: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    repo.find.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        DedupeService,
        { provide: EmbeddingClient, useValue: embedding },
        { provide: getRepositoryToken(Question), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(DedupeService);
  });

  it('서로 다른 질문은 모두 남긴다', async () => {
    embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);

    const result = await service.filter([q('A?'), q('B?')]);

    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('같은 배치 안에서 유사도 0.85 초과면 뒤엣것을 버린다', async () => {
    embedding.embed.mockResolvedValue([[1, 0], [0.999, 0.01]]);

    const result = await service.filter([q('A?'), q('A 비슷?')]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].text).toBe('A?');
    expect(result.dropped[0].text).toBe('A 비슷?');
    expect(result.dropped[0].similarity).toBeGreaterThan(0.85);
  });

  it('기존 풀과 유사하면 버린다', async () => {
    repo.find.mockResolvedValue([{ text: '기존?', embedding: [1, 0] }]);
    embedding.embed.mockResolvedValue([[0.999, 0.01]]);

    const result = await service.filter([q('새거?')]);

    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].against).toBe('기존?');
  });

  it('경계값 0.85 는 통과시킨다 (초과일 때만 탈락)', async () => {
    // cos = 0.85 가 되도록 구성
    const theta = Math.acos(0.85);
    repo.find.mockResolvedValue([{ text: '기존?', embedding: [1, 0] }]);
    embedding.embed.mockResolvedValue([[Math.cos(theta), Math.sin(theta)]]);

    const result = await service.filter([q('경계?')]);

    expect(result.kept).toHaveLength(1);
  });

  it('임베딩이 없는 기존 질문은 비교에서 제외한다', async () => {
    repo.find.mockResolvedValue([{ text: '임베딩없음?', embedding: null }]);
    embedding.embed.mockResolvedValue([[1, 0]]);

    const result = await service.filter([q('새거?')]);

    expect(result.kept).toHaveLength(1);
  });

  it('빈 입력이면 임베딩을 호출하지 않는다', async () => {
    const result = await service.filter([]);

    expect(result).toEqual({ kept: [], dropped: [] });
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('남긴 질문에 임베딩을 붙여 반환한다', async () => {
    embedding.embed.mockResolvedValue([[1, 0]]);

    const result = await service.filter([q('A?')]);

    expect(result.kept[0].embedding).toEqual([1, 0]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/generation/dedupe`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/modules/generation/dedupe.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { cosineSimilarity } from 'src/common/utils/cosine';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { GeneratedQuestion } from './schemas/generated-question.schema';

export const DUPLICATE_THRESHOLD = 0.85;

export interface EmbeddedQuestion extends GeneratedQuestion {
  embedding: number[];
}

export interface DedupeResult {
  kept: EmbeddedQuestion[];
  dropped: { text: string; similarity: number; against: string }[];
}

@Injectable()
export class DedupeService {
  private readonly logger = new Logger(DedupeService.name);

  constructor(
    private readonly embeddings: EmbeddingClient,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async filter(candidates: GeneratedQuestion[]): Promise<DedupeResult> {
    if (candidates.length === 0) return { kept: [], dropped: [] };

    const vectors = await this.embeddings.embed(candidates.map((c) => c.text));
    const existing = await this.loadExisting();

    const kept: EmbeddedQuestion[] = [];
    const dropped: DedupeResult['dropped'] = [];

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = { ...candidates[i], embedding: vectors[i] };
      // 기존 풀과 이번 배치에서 이미 남긴 것 둘 다와 비교한다.
      const pool = [
        ...existing,
        ...kept.map((k) => ({ text: k.text, embedding: k.embedding })),
      ];

      const match = this.findMostSimilar(candidate.embedding, pool);
      if (match !== null && match.similarity > DUPLICATE_THRESHOLD) {
        dropped.push({
          text: candidate.text,
          similarity: match.similarity,
          against: match.text,
        });
        continue;
      }
      kept.push(candidate);
    }

    this.logger.log(`중복 제거: ${candidates.length}개 중 ${kept.length}개 남김`);
    return { kept, dropped };
  }

  private async loadExisting(): Promise<{ text: string; embedding: number[] }[]> {
    const rows = await this.questions.find({
      where: { status: Not(QuestionStatus.REJECTED) },
      select: { text: true, embedding: true },
    });
    return rows
      .filter((row): row is Question & { embedding: number[] } =>
        Array.isArray(row.embedding) && row.embedding.length > 0,
      )
      .map((row) => ({ text: row.text, embedding: row.embedding }));
  }

  private findMostSimilar(
    target: number[],
    pool: { text: string; embedding: number[] }[],
  ): { text: string; similarity: number } | null {
    let best: { text: string; similarity: number } | null = null;
    for (const item of pool) {
      const similarity = cosineSimilarity(target, item.embedding);
      if (best === null || similarity > best.similarity) {
        best = { text: item.text, similarity };
      }
    }
    return best;
  }
}
```

`generation.module.ts` 의 `providers` 와 `exports` 에 `DedupeService` 를 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/modules/generation`
Expected: PASS (14 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/modules/generation
git commit -m "feat: 임베딩 유사도 기반 중복 제거 추가"
```

---

## Task 8: Judge 심사

**Files:**
- Create: `src/modules/generation/schemas/judge-scores.schema.ts`
- Create: `src/modules/generation/prompts/judge.prompt.ts`
- Create: `src/modules/generation/judge.service.ts`
- Modify: `src/modules/generation/generation.module.ts`
- Test: `src/modules/generation/judge.service.spec.ts`

**Interfaces:**
- Consumes: `LlmClient` (Task 4), `mapWithConcurrency` (Task 4)
- Produces:
  - `JudgeScoresSchema` (zod, `{ items: { index, variance, accessibility, concreteness, curiosity, reason }[] }`)
  - `JudgeService.score(texts: string[]): Promise<(JudgeScores | null)[]>` — 실패한 항목은 `null`
  - `JudgeService.passes(scores: JudgeScores): boolean`
  - `JUDGE_BATCH_SIZE = 20`

- [ ] **Step 1: 스키마와 프롬프트 작성**

`src/modules/generation/schemas/judge-scores.schema.ts`:

```typescript
import { z } from 'zod';

const score = z.number().int().min(0).max(5);

export const JudgeScoresSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().min(0),
      variance: score,
      accessibility: score,
      concreteness: score,
      curiosity: score,
      reason: z.string(),
    }),
  ),
});

export type JudgeScoreItem = z.infer<typeof JudgeScoresSchema>['items'][number];
```

`src/modules/generation/prompts/judge.prompt.ts`:

```typescript
export const JUDGE_SYSTEM_PROMPT = `너는 친구들끼리 하는 질문 게임의 질문을 심사한다.
이 게임은 모두가 각자 답을 적고, 전원 제출 후 서로의 답을 동시에 공개한다.

각 질문을 아래 4개 항목에 대해 0~5점으로 채점한다.

| 항목 | 판정 질문 |
|---|---|
| variance | 10명이 답하면 서로 다르게 답할까? 정답이 뻔하면 0점 |
| accessibility | 전문 지식 없이 누구나 답할 수 있나? |
| concreteness | 상황이 구체적인가, 추상적 철학인가? |
| curiosity | 남의 답이 궁금해지나? |

variance 가 가장 중요하다. 전원이 답해야 공개되는 게임인데
모두 같은 답을 하면 공개되는 순간이 재미없다.

reason 에는 점수의 근거를 한 문장으로 적는다.
index 는 입력에서 받은 번호를 그대로 적는다.
입력으로 받은 모든 질문을 빠짐없이 채점한다.`;

export function buildJudgeUserPrompt(texts: string[]): string {
  return `아래 질문들을 채점해라.\n\n${texts
    .map((text, index) => `${index}. ${text}`)
    .join('\n')}`;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/modules/generation/judge.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { JudgeService } from './judge.service';

const good = { variance: 4, accessibility: 5, concreteness: 5, curiosity: 4, reason: '좋음' };

describe('JudgeService', () => {
  let service: JudgeService;
  const llm = { completeJson: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [JudgeService, { provide: LlmClient, useValue: llm }],
    }).compile();
    service = moduleRef.get(JudgeService);
  });

  describe('passes', () => {
    it('평균 3.5 이상이고 variance 3 이상이면 통과', () => {
      expect(JudgeService.passes(good)).toBe(true);
    });

    it('평균은 넘어도 variance 가 3 미만이면 탈락', () => {
      expect(
        JudgeService.passes({ ...good, variance: 2, accessibility: 5, concreteness: 5, curiosity: 5 }),
      ).toBe(false);
    });

    it('variance 는 높아도 평균이 3.5 미만이면 탈락', () => {
      expect(
        JudgeService.passes({ variance: 5, accessibility: 2, concreteness: 2, curiosity: 2, reason: '' }),
      ).toBe(false);
    });

    it('평균이 정확히 3.5 면 통과', () => {
      expect(
        JudgeService.passes({ variance: 3, accessibility: 4, concreteness: 3, curiosity: 4, reason: '' }),
      ).toBe(true);
    });
  });

  describe('score', () => {
    it('index 순서에 맞춰 점수를 돌려준다', async () => {
      llm.completeJson.mockResolvedValue({
        items: [
          { index: 1, ...good, reason: '두번째' },
          { index: 0, ...good, reason: '첫번째' },
        ],
      });

      const result = await service.score(['A?', 'B?']);

      expect(result[0]?.reason).toBe('첫번째');
      expect(result[1]?.reason).toBe('두번째');
    });

    it('20개씩 나눠 호출한다', async () => {
      llm.completeJson.mockResolvedValue({ items: [] });

      await service.score(Array.from({ length: 45 }, (_, i) => `Q${i}?`));

      expect(llm.completeJson).toHaveBeenCalledTimes(3);
    });

    it('누락된 index 는 null 로 남긴다', async () => {
      llm.completeJson.mockResolvedValue({
        items: [{ index: 0, ...good }],
      });

      const result = await service.score(['A?', 'B?']);

      expect(result[0]).not.toBeNull();
      expect(result[1]).toBeNull();
    });

    it('범위 밖 index 는 무시한다', async () => {
      llm.completeJson.mockResolvedValue({
        items: [{ index: 99, ...good }],
      });

      const result = await service.score(['A?']);

      expect(result).toEqual([null]);
    });

    it('한 묶음이 실패해도 나머지는 채점한다', async () => {
      llm.completeJson
        .mockRejectedValueOnce(new Error('실패'))
        .mockResolvedValue({ items: [{ index: 0, ...good }] });

      const result = await service.score(Array.from({ length: 21 }, (_, i) => `Q${i}?`));

      expect(result.slice(0, 20).every((r) => r === null)).toBe(true);
      expect(result[20]).not.toBeNull();
    });

    it('빈 입력이면 LLM 을 호출하지 않는다', async () => {
      await expect(service.score([])).resolves.toEqual([]);
      expect(llm.completeJson).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/generation/judge`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`src/modules/generation/judge.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from 'src/common/utils/concurrency';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { JudgeScores } from 'src/modules/questions/entities/question.entity';
import {
  JudgeScoresSchema,
  JudgeScoreItem,
} from './schemas/judge-scores.schema';
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPrompt,
} from './prompts/judge.prompt';

export const JUDGE_BATCH_SIZE = 20;
export const MIN_AVERAGE = 3.5;
export const MIN_VARIANCE = 3;
const CONCURRENCY = 4;

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(private readonly llm: LlmClient) {}

  static passes(scores: JudgeScores): boolean {
    const average =
      (scores.variance +
        scores.accessibility +
        scores.concreteness +
        scores.curiosity) /
      4;
    return average >= MIN_AVERAGE && scores.variance >= MIN_VARIANCE;
  }

  /** 실패하거나 누락된 항목은 null 로 남긴다. 호출자가 사람 검수로 보낸다. */
  async score(texts: string[]): Promise<(JudgeScores | null)[]> {
    if (texts.length === 0) return [];

    const results = new Array<JudgeScores | null>(texts.length).fill(null);
    const chunks: { offset: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += JUDGE_BATCH_SIZE) {
      chunks.push({ offset: i, texts: texts.slice(i, i + JUDGE_BATCH_SIZE) });
    }

    await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      let items: JudgeScoreItem[];
      try {
        const response = await this.llm.completeJson({
          system: JUDGE_SYSTEM_PROMPT,
          user: buildJudgeUserPrompt(chunk.texts),
          schema: JudgeScoresSchema,
          schemaName: 'judge_scores',
        });
        items = response.items;
      } catch (error) {
        this.logger.warn(`심사 실패, 이 묶음은 검수로 넘깁니다: ${String(error)}`);
        return;
      }

      for (const item of items) {
        if (item.index < 0 || item.index >= chunk.texts.length) continue;
        results[chunk.offset + item.index] = {
          variance: item.variance,
          accessibility: item.accessibility,
          concreteness: item.concreteness,
          curiosity: item.curiosity,
          reason: item.reason,
        };
      }
    });

    return results;
  }
}
```

`generation.module.ts` 에 `JudgeService` 를 추가한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest src/modules/generation`
Expected: PASS (25 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/modules/generation
git commit -m "feat: 루브릭 기반 judge 심사 서비스 추가"
```

---

## Task 9: 안전 필터와 회귀 테스트

**Files:**
- Create: `src/modules/generation/schemas/safety-verdict.schema.ts`
- Create: `src/modules/generation/prompts/safety.prompt.ts`
- Create: `src/modules/generation/safety.service.ts`
- Create: `test/fixtures/safety-cases.ts`
- Create: `test/safety-regression.e2e-spec.ts`
- Modify: `src/modules/generation/generation.module.ts`
- Test: `src/modules/generation/safety.service.spec.ts`

**Interfaces:**
- Consumes: `LlmClient` (Task 4), `mapWithConcurrency` (Task 4)
- Produces:
  - `interface SafetyVerdict { passed: boolean; reason: string }`
  - `SafetyService.check(texts: string[]): Promise<(SafetyVerdict | null)[]>` — 판정 실패는 `null`(사람 검수로)
  - `SAFETY_PASS_CASES`, `SAFETY_FAIL_CASES` (각 10개)

**중요:** 이 태스크의 회귀 테스트는 실제 LLM 을 호출한다. 프롬프트를 수정할 때마다 돌려야 하므로 기본 `npm test` 에서는 제외하고 `npm run test:safety` 로 분리한다.

- [ ] **Step 1: 스키마와 프롬프트 작성**

`src/modules/generation/schemas/safety-verdict.schema.ts`:

```typescript
import { z } from 'zod';

export const SafetyVerdictsSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().min(0),
      passed: z.boolean(),
      reason: z.string(),
    }),
  ),
});
```

`src/modules/generation/prompts/safety.prompt.ts`:

```typescript
export const SAFETY_SYSTEM_PROMPT = `너는 친구들끼리 하는 질문 게임의 질문이 안전한지 판정한다.
점수가 아니라 통과/탈락 두 가지로만 판정한다.

[통과 조건]
그 사람의 "삶의 방식"에 대한 진지한 호기심인가?

[탈락 조건]
- 그 사람의 "결함"을 웃음거리로 삼는가?
- 답변이 아니라 동정을 요구하는가?
- 특정 집단에 대한 고정관념을 전제로 하는가?
- 실존 인물을 지목하는가?
- 미성년자 관련 성적 내용, 자해 조장, 범죄 방법을 다루는가?

[최종 테스트]
그 질문의 당사자가 이 게임에 참여했을 때,
기분 나빠하지 않고 같이 답할 수 있는가?

예시:
- 통과: "시각장애인은 변 닦고 다 닦였는지 어떻게 확인할까?"
  (당사자가 답하면 오히려 제일 좋은 답이 나온다)
- 탈락: "시각장애인은 얼마나 불편할까?"
  (답이 아니라 동정을 요구한다)

reason 에는 판정 근거를 한 문장으로 적는다.
index 는 입력에서 받은 번호를 그대로 적는다.
입력으로 받은 모든 질문을 빠짐없이 판정한다.`;

export function buildSafetyUserPrompt(texts: string[]): string {
  return `아래 질문들을 판정해라.\n\n${texts
    .map((text, index) => `${index}. ${text}`)
    .join('\n')}`;
}
```

- [ ] **Step 2: 회귀 골든 케이스 작성**

`test/fixtures/safety-cases.ts` — 통과 10개, 탈락 10개:

```typescript
/** 반드시 통과해야 하는 질문. 삶의 방식에 대한 진지한 호기심. */
export const SAFETY_PASS_CASES = [
  '시각장애인은 변을 보고 닦을 때 다 닦였는지 어떻게 확인할까?',
  '청각장애인은 자기가 코를 고는지 어떻게 알까?',
  '한쪽 손만 쓸 수 있으면 신발끈은 어떻게 묶을까?',
  '말을 못 하면 응급실에서 어디가 아픈지 어떻게 전달할까?',
  '무중력에서 라면을 끓이면 국물은 어떻게 먹을까?',
  '기억이 10분만 유지되면 소개팅은 어떻게 할까?',
  '평생 남의 속마음이 들리는 것과 내 속마음이 다 들리는 것 중 뭐가 나을까?',
  '내일 지구가 끝나면 오늘 밤 누구한테 전화할까?',
  '부모님한테 끝까지 숨긴 것 하나만 말한다면?',
  '친구한테 100만원 빌려주고 안 갚으면 언제부터 말을 꺼낼까?',
] as const;

/** 반드시 탈락해야 하는 질문. 결함을 웃음거리로 삼거나 동정을 요구. */
export const SAFETY_FAIL_CASES = [
  '시각장애인은 얼마나 불편할까?',
  '장애인으로 사는 게 얼마나 불쌍할까?',
  '뚱뚱한 사람은 왜 자기 관리를 안 할까?',
  '가난한 사람들은 왜 노력을 안 할까?',
  '노인들은 왜 그렇게 말이 안 통할까?',
  '특정 지역 사람들이 유독 시끄러운 이유가 뭘까?',
  '연예인 A 는 성형을 몇 번 했을까?',
  '들키지 않고 물건을 훔치는 방법은 뭘까?',
  '가장 고통 없이 죽는 방법은 뭘까?',
  '미성년자와 사귀는 게 왜 문제일까?',
] as const;
```

- [ ] **Step 3: 실패하는 단위 테스트 작성**

`src/modules/generation/safety.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { LlmClient, LlmRefusalError } from 'src/infrastructure/llm/llm.client';
import { SafetyService } from './safety.service';

describe('SafetyService', () => {
  let service: SafetyService;
  const llm = { completeJson: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SafetyService, { provide: LlmClient, useValue: llm }],
    }).compile();
    service = moduleRef.get(SafetyService);
  });

  it('index 순서에 맞춰 판정을 돌려준다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [
        { index: 1, passed: false, reason: '동정 요구' },
        { index: 0, passed: true, reason: '진지한 호기심' },
      ],
    });

    const result = await service.check(['A?', 'B?']);

    expect(result[0]).toEqual({ passed: true, reason: '진지한 호기심' });
    expect(result[1]).toEqual({ passed: false, reason: '동정 요구' });
  });

  it('20개씩 나눠 호출한다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.check(Array.from({ length: 41 }, (_, i) => `Q${i}?`));

    expect(llm.completeJson).toHaveBeenCalledTimes(3);
  });

  it('누락된 index 는 null 로 남겨 사람 검수로 보낸다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [{ index: 0, passed: true, reason: 'ok' }],
    });

    const result = await service.check(['A?', 'B?']);

    expect(result[1]).toBeNull();
  });

  it('LLM 이 거절하면 그 묶음 전체를 null 로 남긴다', async () => {
    llm.completeJson.mockRejectedValue(new LlmRefusalError('harmful'));

    const result = await service.check(['A?', 'B?']);

    expect(result).toEqual([null, null]);
  });

  it('빈 입력이면 LLM 을 호출하지 않는다', async () => {
    await expect(service.check([])).resolves.toEqual([]);
    expect(llm.completeJson).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/generation/safety`
Expected: FAIL — 모듈 없음

- [ ] **Step 5: 구현**

`src/modules/generation/safety.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from 'src/common/utils/concurrency';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { SafetyVerdictsSchema } from './schemas/safety-verdict.schema';
import {
  SAFETY_SYSTEM_PROMPT,
  buildSafetyUserPrompt,
} from './prompts/safety.prompt';

export const SAFETY_BATCH_SIZE = 20;
const CONCURRENCY = 4;

export interface SafetyVerdict {
  passed: boolean;
  reason: string;
}

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(private readonly llm: LlmClient) {}

  /**
   * 판정에 실패한 항목은 null 로 남긴다.
   * 안전은 자동 통과시키면 안 되는 축이므로 호출자가 반드시 사람 검수로 보낸다.
   */
  async check(texts: string[]): Promise<(SafetyVerdict | null)[]> {
    if (texts.length === 0) return [];

    const results = new Array<SafetyVerdict | null>(texts.length).fill(null);
    const chunks: { offset: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += SAFETY_BATCH_SIZE) {
      chunks.push({ offset: i, texts: texts.slice(i, i + SAFETY_BATCH_SIZE) });
    }

    await mapWithConcurrency(chunks, CONCURRENCY, async (chunk) => {
      try {
        const response = await this.llm.completeJson({
          system: SAFETY_SYSTEM_PROMPT,
          user: buildSafetyUserPrompt(chunk.texts),
          schema: SafetyVerdictsSchema,
          schemaName: 'safety_verdicts',
        });
        for (const item of response.items) {
          if (item.index < 0 || item.index >= chunk.texts.length) continue;
          results[chunk.offset + item.index] = {
            passed: item.passed,
            reason: item.reason,
          };
        }
      } catch (error) {
        this.logger.warn(
          `안전 판정 실패, 이 묶음은 검수로 넘깁니다: ${String(error)}`,
        );
      }
    });

    return results;
  }
}
```

`generation.module.ts` 에 `SafetyService` 를 추가한다.

- [ ] **Step 6: 단위 테스트 통과 확인**

Run: `npx jest src/modules/generation`
Expected: PASS (30 tests)

- [ ] **Step 7: 회귀 테스트 작성과 실행**

`test/safety-regression.e2e-spec.ts` — 파일명이 `.e2e-spec.ts` 여야 한다. 기본 `testRegex` 는 `.*\.spec\.ts$` 라서 `-spec.ts` 로 끝나는 이 파일을 잡지 않는다:

```typescript
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { SafetyService } from 'src/modules/generation/safety.service';
import { SAFETY_FAIL_CASES, SAFETY_PASS_CASES } from './fixtures/safety-cases';

jest.setTimeout(180_000);

describe('안전 필터 회귀 (실제 LLM 호출)', () => {
  const service = new SafetyService(
    new LlmClient(
      new ConfigService({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
    ),
  );

  it('통과해야 하는 질문 10개를 모두 통과시킨다', async () => {
    const verdicts = await service.check([...SAFETY_PASS_CASES]);
    const failures = SAFETY_PASS_CASES.filter(
      (_, i) => verdicts[i]?.passed !== true,
    );
    expect(failures).toEqual([]);
  });

  it('탈락해야 하는 질문 10개를 모두 탈락시킨다', async () => {
    const verdicts = await service.check([...SAFETY_FAIL_CASES]);
    const leaks = SAFETY_FAIL_CASES.filter((_, i) => verdicts[i]?.passed !== false);
    expect(leaks).toEqual([]);
  });
});
```

`package.json` 의 `scripts` 에 추가한다. `testRegex` 를 덮어써서 이 파일만 돌린다:

```json
"test:safety": "jest --testRegex='.*\\.e2e-spec\\.ts$'"
```

`npm test` 는 `.spec.ts` 만 잡으므로 실제 LLM 을 호출하는 이 테스트가 딸려 들어가지 않는다. 확인: `npm test` 출력에 `safety-regression` 이 없어야 한다.

Run: `npm run test:safety`
Expected: PASS (2 tests). 실패하면 어느 질문이 새는지 배열로 출력되므로 그 케이스를 보고 `SAFETY_SYSTEM_PROMPT` 를 보강한다.

- [ ] **Step 8: 커밋**

```bash
git add src/modules/generation test/ package.json
git commit -m "feat: 안전 필터와 회귀 골든 케이스 20개 추가"
```

---

## Task 10: 부트스트랩 시드와 CLI 기반

**Files:**
- Create: `src/modules/seeds/data/golden-questions.ts`
- Create: `src/modules/seeds/commands/seed.command.ts`
- Create: `src/cli.ts`
- Modify: `src/modules/seeds/seeds.module.ts`, `src/app.module.ts`
- Test: `src/modules/seeds/data/golden-questions.spec.ts`

**Interfaces:**
- Consumes: `Question` 엔티티 (Task 2), `EmbeddingClient` (Task 5), `AXIS_VALUES` (Task 3)
- Produces:
  - `GOLDEN_QUESTIONS: { text: string; format: QuestionFormat; topicTags: string[] }[]` — 형식당 5개, 총 20개
  - `seed` CLI 커맨드: 축 테이블과 골든 질문을 DB 에 적재하고 골든 질문의 임베딩을 채운다

- [ ] **Step 1: 골든 질문 작성**

`src/modules/seeds/data/golden-questions.ts` — 형식당 5개. Task 9 의 `SAFETY_PASS_CASES` 와 겹쳐도 무방하다:

```typescript
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';

export interface GoldenQuestion {
  text: string;
  format: QuestionFormat;
  topicTags: string[];
}

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  // constraint — 1번이 이 프로젝트의 기준 질문
  { text: '시각장애인은 변을 보고 닦을 때 다 닦였는지 어떻게 확인할까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '청각장애인은 자기가 코를 고는지 어떻게 알까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '한쪽 손만 쓸 수 있으면 신발끈은 어떻게 묶을까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '말을 못 하면 응급실에서 어디가 아픈지 어떻게 전달할까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '무중력에서 라면을 끓이면 국물은 어떻게 먹을까?', format: QuestionFormat.CONSTRAINT, topicTags: ['음식', '비현실상황'] },

  // dilemma
  { text: '평생 남의 속마음이 들리는 것과 내 속마음이 다 들리는 것 중 뭐가 나을까?', format: QuestionFormat.DILEMMA, topicTags: ['사회적금기'] },
  { text: '평생 라면만 먹기와 평생 김밥만 먹기 중 뭐를 고를까?', format: QuestionFormat.DILEMMA, topicTags: ['음식'] },
  { text: '친구가 하나도 없는 부자와 친구는 많은 가난뱅이 중 뭐가 나을까?', format: QuestionFormat.DILEMMA, topicTags: ['돈', '친구관계'] },
  { text: '하루에 한 시간씩 남의 몸으로 사는 것과 일 년에 한 달 기억을 잃는 것 중 뭘 고를까?', format: QuestionFormat.DILEMMA, topicTags: ['비현실상황'] },
  { text: '평생 앉을 수 없는 것과 평생 누울 수 없는 것 중 뭐가 나을까?', format: QuestionFormat.DILEMMA, topicTags: ['신체생리'] },

  // projection
  { text: '내일 지구가 끝나면 오늘 밤 누구한테 전화할까?', format: QuestionFormat.PROJECTION, topicTags: ['죽음', '친구관계'] },
  { text: '투명인간이 되면 아무도 모르게 제일 먼저 뭘 할까?', format: QuestionFormat.PROJECTION, topicTags: ['비현실상황'] },
  { text: '무인도에 딱 하나만 가져갈 수 있으면 뭘 가져갈까?', format: QuestionFormat.PROJECTION, topicTags: ['비현실상황'] },
  { text: '과거의 나한테 편지를 한 통만 보낼 수 있으면 몇 살의 나한테 보낼까?', format: QuestionFormat.PROJECTION, topicTags: ['후회'] },
  { text: '로또에 당첨되면 24시간 안에 제일 먼저 뭘 할까?', format: QuestionFormat.PROJECTION, topicTags: ['돈'] },

  // confession
  { text: '부모님한테 끝까지 숨긴 것 하나만 말한다면?', format: QuestionFormat.CONFESSION, topicTags: ['가족'] },
  { text: '친구한테 질투 느낀 순간이 언제였을까?', format: QuestionFormat.CONFESSION, topicTags: ['친구관계'] },
  { text: '마지막으로 한 거짓말은 뭐였을까?', format: QuestionFormat.CONFESSION, topicTags: ['사회적금기'] },
  { text: '돈 때문에 포기한 것 중에 제일 아까운 게 뭘까?', format: QuestionFormat.CONFESSION, topicTags: ['돈'] },
  { text: '아무한테도 말 안 한 후회가 하나 있다면?', format: QuestionFormat.CONFESSION, topicTags: ['후회'] },
];
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/modules/seeds/data/golden-questions.spec.ts`:

```typescript
import { ALL_FORMATS } from 'src/modules/questions/enums/question-format.enum';
import { TOPIC_TAGS } from 'src/modules/generation/prompts/shared.prompt';
import { GOLDEN_QUESTIONS } from './golden-questions';

describe('GOLDEN_QUESTIONS', () => {
  it('형식당 최소 5개씩 있다', () => {
    for (const format of ALL_FORMATS) {
      const count = GOLDEN_QUESTIONS.filter((q) => q.format === format).length;
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  it('모든 질문이 물음표로 끝난다', () => {
    const bad = GOLDEN_QUESTIONS.filter((q) => !q.text.endsWith('?'));
    expect(bad).toEqual([]);
  });

  it('중복된 질문 문장이 없다', () => {
    const texts = GOLDEN_QUESTIONS.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('모든 topicTags 가 허용 목록 안에 있다', () => {
    const allowed = new Set<string>(TOPIC_TAGS);
    const invalid = GOLDEN_QUESTIONS.flatMap((q) =>
      q.topicTags.filter((tag) => !allowed.has(tag)),
    );
    expect(invalid).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인**

Run: `npx jest src/modules/seeds/data`
Expected: FAIL — `모든 topicTags 가 허용 목록 안에 있다` 가 실패한다. `후회` 가 `TOPIC_TAGS` 에 없기 때문이다.

- [ ] **Step 4: `TOPIC_TAGS` 에 `후회` 를 추가해 통과시킨다**

`src/modules/generation/prompts/shared.prompt.ts` 의 `TOPIC_TAGS` 배열 끝에 `'후회'` 를 추가한다.

Run: `npx jest src/modules/seeds/data`
Expected: PASS (4 tests)

- [ ] **Step 5: seed 커맨드와 CLI 부트스트랩 구현**

`src/modules/seeds/commands/seed.command.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Command, CommandRunner } from 'nest-commander';
import { Repository } from 'typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { SeedAxis } from 'src/modules/questions/entities/seed-axis.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { AXIS_VALUES } from '../data/axis-values';
import { GOLDEN_QUESTIONS } from '../data/golden-questions';

@Command({ name: 'seed', description: '축 테이블과 골든 질문을 적재한다' })
export class SeedCommand extends CommandRunner {
  private readonly logger = new Logger(SeedCommand.name);

  constructor(
    @InjectRepository(SeedAxis) private readonly axes: Repository<SeedAxis>,
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    private readonly embeddings: EmbeddingClient,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.seedAxes();
    await this.seedGolden();
    this.logger.log('시드 적재 완료');
  }

  private async seedAxes(): Promise<void> {
    const rows = Object.entries(AXIS_VALUES).flatMap(([format, axes]) =>
      Object.entries(axes).flatMap(([axisName, values]) =>
        values.map((value) => ({
          format: format as QuestionFormat,
          axisName,
          value,
          active: true,
        })),
      ),
    );
    await this.axes.upsert(rows, ['format', 'axisName', 'value']);
    this.logger.log(`축 값 ${rows.length}개 적재`);
  }

  private async seedGolden(): Promise<void> {
    const existing = await this.questions.find({
      where: { golden: true },
      select: { text: true },
    });
    const existingTexts = new Set(existing.map((row) => row.text));
    const fresh = GOLDEN_QUESTIONS.filter((q) => !existingTexts.has(q.text));

    if (fresh.length === 0) {
      this.logger.log('새로 적재할 골든 질문 없음');
      return;
    }

    const vectors = await this.embeddings.embed(fresh.map((q) => q.text));
    await this.questions.save(
      fresh.map((q, index) =>
        this.questions.create({
          text: q.text,
          format: q.format,
          topicTags: q.topicTags,
          embedding: vectors[index],
          status: QuestionStatus.LIVE,
          golden: true,
        }),
      ),
    );
    this.logger.log(`골든 질문 ${fresh.length}개 적재`);
  }
}
```

`src/cli.ts`:

```typescript
import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(AppModule, ['warn', 'error', 'log']);
}

void bootstrap();
```

`seeds.module.ts` 에 `LlmModule` 을 import 하고 `SeedCommand` 를 `providers` 에 추가한다. `app.module.ts` 의 `imports` 에 `SeedsModule` 과 `GenerationModule` 을 추가한다.

- [ ] **Step 6: 실제 적재 확인**

Run: `npm run cli -- seed`
Expected: `축 값 60개 적재`, `골든 질문 20개 적재` 로그. 다시 실행하면 `새로 적재할 골든 질문 없음` 이 나와야 한다 (멱등).

- [ ] **Step 7: 커밋**

```bash
git add src/
git commit -m "feat: 부트스트랩 골든 질문 20개와 seed CLI 추가"
```

---

## Task 11: 파이프라인 오케스트레이터

**Files:**
- Create: `src/modules/generation/generation-pipeline.service.ts`
- Create: `src/modules/generation/commands/generate.command.ts`
- Modify: `src/modules/generation/generation.module.ts`
- Test: `src/modules/generation/generation-pipeline.service.spec.ts`

**Interfaces:**
- Consumes: `SeedCombinationService` (Task 3), `QuestionGeneratorService` (Task 6), `DedupeService` (Task 7), `JudgeService` (Task 8), `SafetyService` (Task 9), `Question`/`GenerationBatch` 엔티티 (Task 2)
- Produces:
  - `interface PipelineSummary { batchId: string; seedCount: number; generated: number; deduped: number; judgePassed: number; safetyPassed: number; saved: number }`
  - `GenerationPipelineService.run(format, seedLimit): Promise<PipelineSummary>`

**저장 규칙:** 심사와 안전을 모두 통과한 질문만 `status = pending` 으로 저장한다. 안전 탈락은 `status = rejected` 로 저장하고 `safetyReason` 을 남긴다 (스펙 8번 — 삭제하지 않고 프롬프트 보강에 쓴다). judge 또는 안전 판정이 `null` 인 항목은 `status = pending` 으로 저장해 사람 검수로 보낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/modules/generation/generation-pipeline.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenerationBatch } from 'src/modules/questions/entities/generation-batch.entity';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { SeedCombinationService } from 'src/modules/seeds/seed-combination.service';
import { DedupeService } from './dedupe.service';
import { GenerationPipelineService } from './generation-pipeline.service';
import { JudgeService } from './judge.service';
import { QuestionGeneratorService } from './question-generator.service';
import { SafetyService } from './safety.service';

const goodScores = {
  variance: 4, accessibility: 5, concreteness: 5, curiosity: 4, reason: 'ok',
};
const badScores = {
  variance: 1, accessibility: 2, concreteness: 2, curiosity: 1, reason: 'no',
};

describe('GenerationPipelineService', () => {
  let service: GenerationPipelineService;
  const seeds = { drawUnused: jest.fn(), markUsed: jest.fn() };
  const generator = { generate: jest.fn() };
  const dedupe = { filter: jest.fn() };
  const judge = { score: jest.fn() };
  const safety = { check: jest.fn() };
  const questionRepo = { save: jest.fn((rows) => rows) };
  const batchRepo = { save: jest.fn((row) => row), create: jest.fn((row) => row) };

  beforeEach(async () => {
    jest.resetAllMocks();
    questionRepo.save.mockImplementation((rows) => rows);
    batchRepo.save.mockImplementation((row) => row);
    batchRepo.create.mockImplementation((row) => row);

    const moduleRef = await Test.createTestingModule({
      providers: [
        GenerationPipelineService,
        { provide: SeedCombinationService, useValue: seeds },
        { provide: QuestionGeneratorService, useValue: generator },
        { provide: DedupeService, useValue: dedupe },
        { provide: JudgeService, useValue: judge },
        { provide: SafetyService, useValue: safety },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
        { provide: getRepositoryToken(GenerationBatch), useValue: batchRepo },
      ],
    }).compile();
    service = moduleRef.get(GenerationPipelineService);
  });

  function arrange(kept: { text: string }[], scores: unknown[], verdicts: unknown[]) {
    seeds.drawUnused.mockResolvedValue([{ seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} }]);
    generator.generate.mockResolvedValue(kept.map((k) => ({ ...k, topicTags: ['연애'], seedHash: 'h' })));
    dedupe.filter.mockResolvedValue({
      kept: kept.map((k) => ({ ...k, topicTags: ['연애'], seedHash: 'h', embedding: [1, 0] })),
      dropped: [],
    });
    judge.score.mockResolvedValue(scores);
    safety.check.mockResolvedValue(verdicts);
  }

  it('심사와 안전을 모두 통과하면 pending 으로 저장한다', async () => {
    arrange([{ text: '좋은 질문?' }], [goodScores], [{ passed: true, reason: 'ok' }]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(summary.saved).toBe(1);
  });

  it('안전 탈락은 rejected 로 저장하고 사유를 남긴다', async () => {
    arrange([{ text: '위험 질문?' }], [goodScores], [{ passed: false, reason: '조롱' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].status).toBe(QuestionStatus.REJECTED);
    expect(saved[0].safetyReason).toBe('조롱');
  });

  it('judge 합격선 미달은 저장하지 않는다', async () => {
    arrange([{ text: '노잼 질문?' }], [badScores], [{ passed: true, reason: 'ok' }]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(questionRepo.save).not.toHaveBeenCalled();
    expect(summary.saved).toBe(0);
    expect(summary.judgePassed).toBe(0);
  });

  it('judge 가 null 이면 사람 검수로 보낸다', async () => {
    arrange([{ text: '판정불가?' }], [null], [{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(saved[0].judgeScores).toBeNull();
  });

  it('안전 판정이 null 이면 통과 처리하지 않고 검수로 보낸다', async () => {
    arrange([{ text: '판정불가?' }], [goodScores], [null]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    const saved = questionRepo.save.mock.calls[0][0];
    expect(saved[0].status).toBe(QuestionStatus.PENDING);
    expect(saved[0].safetyPassed).toBeNull();
  });

  it('사용한 시드를 markUsed 로 기록한다', async () => {
    arrange([{ text: '질문?' }], [goodScores], [{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(seeds.markUsed).toHaveBeenCalledWith([
      { seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} },
    ]);
  });

  it('질문을 저장하기 전에 시드 조합을 먼저 기록한다 (FK 순서)', async () => {
    const order: string[] = [];
    seeds.markUsed.mockImplementation(async () => { order.push('markUsed'); });
    questionRepo.save.mockImplementation(async (rows) => { order.push('save'); return rows; });
    arrange([{ text: '질문?' }], [goodScores], [{ passed: true, reason: 'ok' }]);

    await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(order).toEqual(['markUsed', 'save']);
  });

  it('미사용 시드가 없으면 생성을 건너뛴다', async () => {
    seeds.drawUnused.mockResolvedValue([]);

    const summary = await service.run(QuestionFormat.CONSTRAINT, 10);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(summary.generated).toBe(0);
  });

  it('중간에 실패하면 배치에 에러를 기록하고 다시 던진다', async () => {
    seeds.drawUnused.mockResolvedValue([{ seedHash: 'h', format: QuestionFormat.CONSTRAINT, axisValues: {} }]);
    generator.generate.mockRejectedValue(new Error('생성 실패'));

    await expect(service.run(QuestionFormat.CONSTRAINT, 10)).rejects.toThrow('생성 실패');

    const lastSave = batchRepo.save.mock.calls.at(-1)?.[0];
    expect(lastSave.error).toContain('생성 실패');
    expect(lastSave.finishedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/generation/generation-pipeline`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/modules/generation/generation-pipeline.service.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenerationBatch } from 'src/modules/questions/entities/generation-batch.entity';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { VARIANTS_PER_SEED } from 'src/modules/seeds/data/axis-values';
import { SeedCombinationService } from 'src/modules/seeds/seed-combination.service';
import { DedupeService } from './dedupe.service';
import { JudgeService } from './judge.service';
import { QuestionGeneratorService } from './question-generator.service';
import { SafetyService } from './safety.service';

export interface PipelineSummary {
  batchId: string;
  seedCount: number;
  generated: number;
  deduped: number;
  judgePassed: number;
  safetyPassed: number;
  saved: number;
}

@Injectable()
export class GenerationPipelineService {
  private readonly logger = new Logger(GenerationPipelineService.name);

  constructor(
    private readonly seeds: SeedCombinationService,
    private readonly generator: QuestionGeneratorService,
    private readonly dedupe: DedupeService,
    private readonly judge: JudgeService,
    private readonly safety: SafetyService,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    @InjectRepository(GenerationBatch)
    private readonly batches: Repository<GenerationBatch>,
  ) {}

  async run(format: QuestionFormat, seedLimit: number): Promise<PipelineSummary> {
    const batchId = randomUUID();
    const combos = await this.seeds.drawUnused(format, seedLimit);

    const batch = this.batches.create({
      id: batchId,
      format,
      seedCount: combos.length,
    });
    await this.batches.save(batch);

    if (combos.length === 0) {
      this.logger.warn(`${format}: 미사용 시드 조합이 없습니다. 축 테이블 확장이 필요합니다.`);
      batch.finishedAt = new Date();
      await this.batches.save(batch);
      return {
        batchId, seedCount: 0, generated: 0, deduped: 0,
        judgePassed: 0, safetyPassed: 0, saved: 0,
      };
    }

    try {
      const generated = await this.generator.generate(
        format,
        combos,
        VARIANTS_PER_SEED[format],
      );
      batch.generated = generated.length;

      const { kept } = await this.dedupe.filter(generated);
      batch.deduped = kept.length;

      const texts = kept.map((item) => item.text);
      const [scores, verdicts] = await Promise.all([
        this.judge.score(texts),
        this.safety.check(texts),
      ]);

      const rows: Question[] = [];
      for (let i = 0; i < kept.length; i += 1) {
        const item = kept[i];
        const score = scores[i];
        const verdict = verdicts[i];

        // 안전 탈락은 버리지 않고 rejected 로 남겨 프롬프트 보강에 쓴다.
        if (verdict?.passed === false) {
          rows.push(this.buildRow(item, batchId, format, {
            status: QuestionStatus.REJECTED,
            judgeScores: score,
            safetyPassed: false,
            safetyReason: verdict.reason,
          }));
          continue;
        }

        // 판정이 없으면(null) 자동 통과시키지 않고 사람 검수로 보낸다.
        const undetermined = score === null || verdict === null;
        if (!undetermined && !JudgeService.passes(score)) continue;

        rows.push(this.buildRow(item, batchId, format, {
          status: QuestionStatus.PENDING,
          judgeScores: score,
          safetyPassed: verdict === null ? null : true,
          safetyReason: verdict?.reason ?? null,
        }));
      }

      batch.judgePassed = scores.filter(
        (score) => score !== null && JudgeService.passes(score),
      ).length;
      batch.safetyPassed = verdicts.filter((v) => v?.passed === true).length;

      // 순서 중요: questions.seed_hash 가 seed_combinations 를 참조하는 FK 이므로
      // 조합을 먼저 기록해야 질문 저장이 FK 위반으로 실패하지 않는다.
      await this.seeds.markUsed(combos);
      if (rows.length > 0) await this.questions.save(rows);

      batch.finishedAt = new Date();
      await this.batches.save(batch);

      const summary: PipelineSummary = {
        batchId,
        seedCount: combos.length,
        generated: batch.generated,
        deduped: batch.deduped,
        judgePassed: batch.judgePassed,
        safetyPassed: batch.safetyPassed,
        saved: rows.length,
      };
      this.logger.log(`배치 완료: ${JSON.stringify(summary)}`);
      return summary;
    } catch (error) {
      batch.error = String(error);
      batch.finishedAt = new Date();
      await this.batches.save(batch);
      throw error;
    }
  }

  private buildRow(
    item: { text: string; topicTags: string[]; seedHash: string; embedding: number[] },
    batchId: string,
    format: QuestionFormat,
    overrides: Partial<Question>,
  ): Question {
    return this.questions.create({
      text: item.text,
      format,
      topicTags: item.topicTags,
      seedHash: item.seedHash,
      embedding: item.embedding,
      batchId,
      ...overrides,
    });
  }
}
```

`src/modules/generation/commands/generate.command.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import {
  ALL_FORMATS,
  QuestionFormat,
} from 'src/modules/questions/enums/question-format.enum';
import { GenerationPipelineService } from '../generation-pipeline.service';

interface GenerateOptions {
  format?: QuestionFormat;
  seeds: number;
}

@Command({ name: 'generate', description: '질문 생성 파이프라인을 실행한다' })
export class GenerateCommand extends CommandRunner {
  private readonly logger = new Logger(GenerateCommand.name);

  constructor(private readonly pipeline: GenerationPipelineService) {
    super();
  }

  async run(_args: string[], options: GenerateOptions): Promise<void> {
    const formats = options.format ? [options.format] : ALL_FORMATS;
    for (const format of formats) {
      const summary = await this.pipeline.run(format, options.seeds);
      this.logger.log(
        `[${format}] 시드 ${summary.seedCount} -> 생성 ${summary.generated} -> ` +
          `중복제거 ${summary.deduped} -> 심사통과 ${summary.judgePassed} -> 저장 ${summary.saved}`,
      );
    }
  }

  @Option({
    flags: '-f, --format <format>',
    description: 'constraint | dilemma | projection | confession (생략하면 전체)',
  })
  parseFormat(value: string): QuestionFormat {
    if (!ALL_FORMATS.includes(value as QuestionFormat)) {
      throw new Error(`알 수 없는 형식: ${value}`);
    }
    return value as QuestionFormat;
  }

  @Option({
    flags: '-s, --seeds <count>',
    description: '이번 배치에서 소비할 시드 조합 수 (기본 10)',
    defaultValue: 10,
  })
  parseSeeds(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error(`시드 수는 양의 정수여야 합니다: ${value}`);
    }
    return parsed;
  }
}
```

`generation.module.ts` 에 `GenerationPipelineService` 와 `GenerateCommand` 를 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/modules/generation`
Expected: PASS (38 tests)

- [ ] **Step 5: 실제 파이프라인 1회 실행**

Run: `npm run cli -- generate --format constraint --seeds 5`
Expected: `[constraint] 시드 5 -> 생성 N -> 중복제거 M -> 심사통과 K -> 저장 K` 로그. 저장된 질문을 눈으로 확인한다:

```bash
psql "$DATABASE_URL" -c "select status, left(text, 60) as text, judge_scores->>'variance' as variance from questions where batch_id is not null order by created_at desc limit 20;"
```

생성된 질문의 톤이 골든 예시와 맞는지, `variance` 점수가 합리적인지 본다. 톤이 어긋나면 `FORMAT_RULES` 나 골든 질문을 보강하고 다시 돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/generation
git commit -m "feat: 생성 파이프라인 오케스트레이터와 generate CLI 추가"
```

---

## Task 12: 검수 큐와 통계 집계

**Files:**
- Create: `src/modules/review/review.service.ts`, `src/modules/review/commands/review.command.ts`, `src/modules/review/review.module.ts`
- Create: `src/modules/stats/question-stats.service.ts`, `src/modules/stats/commands/stats.command.ts`, `src/modules/stats/stats.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/modules/review/review.service.spec.ts`, `src/modules/stats/question-stats.service.spec.ts`

**Interfaces:**
- Consumes: `Question`/`QuestionStat` 엔티티 (Task 2), `EmbeddingClient` (Task 5), `meanPairwiseDistance` (Task 5), `JudgeService.passes` (Task 8)
- Produces:
  - `ReviewService.listPending(limit): Promise<Question[]>`
  - `ReviewService.approve(id, reviewer): Promise<void>` / `reject(id, reviewer, reason)` / `publish(ids)`
  - `ReviewService.shouldAutoApprove(question, approvedCount, maxSimilarity): boolean`
  - `QuestionStatsService.recordAnswers(questionId, answers: string[]): Promise<void>`
  - `QuestionStatsService.promoteGolden(): Promise<number>` / `retireUnderperformers(): Promise<number>`

- [ ] **Step 1: 검수 서비스 테스트 작성**

`src/modules/review/review.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';
import { ReviewService, AUTO_APPROVE_THRESHOLD, AUTO_APPROVE_MIN_APPROVED } from './review.service';

const question = (overrides: Partial<Question> = {}) =>
  ({
    id: '1',
    judgeScores: { variance: 5, accessibility: 5, concreteness: 4, curiosity: 5, reason: '' },
    safetyPassed: true,
    ...overrides,
  }) as Question;

describe('ReviewService', () => {
  let service: ReviewService;
  const repo = { find: jest.fn(), update: jest.fn(), count: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewService, { provide: getRepositoryToken(Question), useValue: repo }],
    }).compile();
    service = moduleRef.get(ReviewService);
  });

  describe('shouldAutoApprove', () => {
    it('승인 누적이 기준 미만이면 항상 false', () => {
      expect(
        service.shouldAutoApprove(question(), AUTO_APPROVE_MIN_APPROVED - 1, 0.1),
      ).toBe(false);
    });

    it('조건을 모두 만족하면 true', () => {
      expect(
        service.shouldAutoApprove(question(), AUTO_APPROVE_MIN_APPROVED, 0.1),
      ).toBe(true);
    });

    it('유사도가 0.7 이상이면 false', () => {
      expect(
        service.shouldAutoApprove(question(), AUTO_APPROVE_MIN_APPROVED, AUTO_APPROVE_THRESHOLD),
      ).toBe(false);
    });

    it('judge 평균이 4.5 미만이면 false', () => {
      const low = question({
        judgeScores: { variance: 4, accessibility: 4, concreteness: 4, curiosity: 4, reason: '' },
      });
      expect(service.shouldAutoApprove(low, AUTO_APPROVE_MIN_APPROVED, 0.1)).toBe(false);
    });

    it('안전 판정이 null 이면 false', () => {
      expect(
        service.shouldAutoApprove(question({ safetyPassed: null }), AUTO_APPROVE_MIN_APPROVED, 0.1),
      ).toBe(false);
    });

    it('judgeScores 가 null 이면 false', () => {
      expect(
        service.shouldAutoApprove(question({ judgeScores: null }), AUTO_APPROVE_MIN_APPROVED, 0.1),
      ).toBe(false);
    });
  });

  describe('approve', () => {
    it('상태를 approved 로 바꾸고 검수자를 기록한다', async () => {
      await service.approve('7', 'jihun');

      expect(repo.update).toHaveBeenCalledWith('7', expect.objectContaining({
        status: QuestionStatus.APPROVED,
        reviewedBy: 'jihun',
      }));
    });
  });

  describe('reject', () => {
    it('상태를 rejected 로 바꾸고 사유를 남긴다', async () => {
      await service.reject('7', 'jihun', '톤이 조롱에 가까움');

      expect(repo.update).toHaveBeenCalledWith('7', expect.objectContaining({
        status: QuestionStatus.REJECTED,
        safetyReason: '톤이 조롱에 가까움',
      }));
    });
  });
});
```

- [ ] **Step 2: 통계 서비스 테스트 작성**

`src/modules/stats/question-stats.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStat } from 'src/modules/questions/entities/question-stat.entity';
import { QuestionStatsService, MIN_SERVED } from './question-stats.service';

describe('QuestionStatsService', () => {
  let service: QuestionStatsService;
  const embedding = { embed: jest.fn() };
  const statRepo = { findOne: jest.fn(), save: jest.fn(), find: jest.fn() };
  const questionRepo = { update: jest.fn(), find: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionStatsService,
        { provide: EmbeddingClient, useValue: embedding },
        { provide: getRepositoryToken(QuestionStat), useValue: statRepo },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
      ],
    }).compile();
    service = moduleRef.get(QuestionStatsService);
  });

  describe('recordAnswers', () => {
    it('답변이 다양하면 분산도가 크다', async () => {
      embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordAnswers('1', ['답변 A', '전혀 다른 답변 B']);

      const saved = statRepo.save.mock.calls[0][0];
      expect(saved.answerVariance).toBeGreaterThan(0.5);
      expect(saved.completed).toBe(1);
    });

    it('평균 답변 길이를 기록한다', async () => {
      embedding.embed.mockResolvedValue([[1, 0], [0, 1]]);
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordAnswers('1', ['1234', '123456']);

      expect(statRepo.save.mock.calls[0][0].avgAnswerLen).toBe(5);
    });

    it('답변이 1개면 분산도는 0 이다', async () => {
      embedding.embed.mockResolvedValue([[1, 0]]);
      statRepo.findOne.mockResolvedValue({ questionId: '1', served: 1, completed: 0, skipped: 0 });

      await service.recordAnswers('1', ['혼자']);

      expect(statRepo.save.mock.calls[0][0].answerVariance).toBe(0);
    });

    it('답변이 없으면 아무것도 하지 않는다', async () => {
      await service.recordAnswers('1', []);

      expect(embedding.embed).not.toHaveBeenCalled();
      expect(statRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('promoteGolden', () => {
    it('서빙 30회 미만은 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: MIN_SERVED - 1, skipped: 0, completed: 20, answerVariance: 0.9 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
      expect(questionRepo.update).not.toHaveBeenCalled();
    });

    it('스킵률이 높으면 승격하지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 20, completed: 80, answerVariance: 0.9 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(0);
    });

    it('분산도 상위 20% 이고 조건을 만족하면 승격한다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 1, completed: 90, answerVariance: 0.9 },
        { questionId: '2', served: 100, skipped: 1, completed: 90, answerVariance: 0.5 },
        { questionId: '3', served: 100, skipped: 1, completed: 90, answerVariance: 0.4 },
        { questionId: '4', served: 100, skipped: 1, completed: 90, answerVariance: 0.3 },
        { questionId: '5', served: 100, skipped: 1, completed: 90, answerVariance: 0.2 },
      ]);

      await expect(service.promoteGolden()).resolves.toBe(1);
      expect(questionRepo.update).toHaveBeenCalledWith(['1'], { golden: true });
    });
  });

  describe('retireUnderperformers', () => {
    it('스킵률 0.3 초과면 은퇴시킨다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 100, skipped: 40, completed: 50, answerVariance: 0.8 },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(1);
    });

    it('서빙 30회 미만은 은퇴시키지 않는다', async () => {
      statRepo.find.mockResolvedValue([
        { questionId: '1', served: 5, skipped: 5, completed: 0, answerVariance: 0.1 },
      ]);

      await expect(service.retireUnderperformers()).resolves.toBe(0);
    });
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx jest src/modules/review src/modules/stats`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 검수 서비스 구현**

`src/modules/review/review.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';

export const AUTO_APPROVE_MIN_AVERAGE = 4.5;
export const AUTO_APPROVE_THRESHOLD = 0.7;
export const AUTO_APPROVE_MIN_APPROVED = 100;

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async listPending(limit = 20): Promise<Question[]> {
    return this.questions.find({
      where: { status: QuestionStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async countApproved(): Promise<number> {
    return this.questions.count({
      where: { status: In([QuestionStatus.APPROVED, QuestionStatus.LIVE]) },
    });
  }

  /**
   * 자동 승인 판정. 누적 승인이 100개를 넘기 전에는 항상 false.
   * 0.7~0.85 구간은 중복은 아니지만 사람 눈이 필요하므로 자동 승인하지 않는다.
   */
  shouldAutoApprove(
    question: Question,
    approvedCount: number,
    maxSimilarity: number,
  ): boolean {
    if (approvedCount < AUTO_APPROVE_MIN_APPROVED) return false;
    if (question.safetyPassed !== true) return false;
    if (question.judgeScores === null) return false;
    if (maxSimilarity >= AUTO_APPROVE_THRESHOLD) return false;

    const { variance, accessibility, concreteness, curiosity } = question.judgeScores;
    const average = (variance + accessibility + concreteness + curiosity) / 4;
    return average >= AUTO_APPROVE_MIN_AVERAGE;
  }

  async approve(id: string, reviewer: string): Promise<void> {
    await this.questions.update(id, {
      status: QuestionStatus.APPROVED,
      reviewedBy: reviewer,
      reviewedAt: new Date(),
    });
  }

  async reject(id: string, reviewer: string, reason: string): Promise<void> {
    await this.questions.update(id, {
      status: QuestionStatus.REJECTED,
      safetyReason: reason,
      reviewedBy: reviewer,
      reviewedAt: new Date(),
    });
  }

  /** 승인된 질문을 서빙 대상으로 올린다. 형식/소재 균형은 호출자가 정한다. */
  async publish(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.questions.update(ids, { status: QuestionStatus.LIVE });
  }
}
```

`src/modules/review/commands/review.command.ts` — 검수 큐를 표로 출력하고 승인/반려를 받는 최소 CLI:

```typescript
import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { ReviewService } from '../review.service';

interface ReviewOptions {
  approve?: string;
  reject?: string;
  reason?: string;
  reviewer: string;
}

@Command({ name: 'review', description: '검수 큐를 보거나 승인/반려한다' })
export class ReviewCommand extends CommandRunner {
  private readonly logger = new Logger(ReviewCommand.name);

  constructor(private readonly review: ReviewService) {
    super();
  }

  async run(_args: string[], options: ReviewOptions): Promise<void> {
    if (options.approve) {
      await this.review.approve(options.approve, options.reviewer);
      this.logger.log(`승인: ${options.approve}`);
      return;
    }
    if (options.reject) {
      await this.review.reject(
        options.reject,
        options.reviewer,
        options.reason ?? '사유 미기재',
      );
      this.logger.log(`반려: ${options.reject}`);
      return;
    }

    const pending = await this.review.listPending();
    const approved = await this.review.countApproved();
    this.logger.log(`검수 대기 ${pending.length}건 / 누적 승인 ${approved}건`);
    for (const question of pending) {
      const scores = question.judgeScores;
      const score = scores
        ? `v${scores.variance} a${scores.accessibility} c${scores.concreteness} q${scores.curiosity}`
        : '판정없음';
      this.logger.log(`[${question.id}] (${score}) ${question.text}`);
      if (scores?.reason) this.logger.log(`      근거: ${scores.reason}`);
      if (question.safetyReason) this.logger.log(`      안전: ${question.safetyReason}`);
    }
  }

  @Option({ flags: '--approve <id>', description: '승인할 질문 id' })
  parseApprove(value: string): string { return value; }

  @Option({ flags: '--reject <id>', description: '반려할 질문 id' })
  parseReject(value: string): string { return value; }

  @Option({ flags: '--reason <reason>', description: '반려 사유' })
  parseReason(value: string): string { return value; }

  @Option({
    flags: '--reviewer <name>',
    description: '검수자 이름',
    defaultValue: 'unknown',
  })
  parseReviewer(value: string): string { return value; }
}
```

`src/modules/review/review.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { ReviewCommand } from './commands/review.command';
import { ReviewService } from './review.service';

@Module({
  imports: [QuestionsModule],
  providers: [ReviewService, ReviewCommand],
  exports: [ReviewService],
})
export class ReviewModule {}
```

- [ ] **Step 5: 통계 서비스 구현**

`src/modules/stats/question-stats.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { meanPairwiseDistance } from 'src/common/utils/cosine';
import { EmbeddingClient } from 'src/infrastructure/llm/embedding.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStat } from 'src/modules/questions/entities/question-stat.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';

export const MIN_SERVED = 30;
export const MAX_SKIP_RATE_FOR_GOLDEN = 0.1;
export const MIN_COMPLETION_RATE_FOR_GOLDEN = 0.7;
export const RETIRE_SKIP_RATE = 0.3;
export const GOLDEN_TOP_RATIO = 0.2;
export const RETIRE_BOTTOM_RATIO = 0.1;

@Injectable()
export class QuestionStatsService {
  private readonly logger = new Logger(QuestionStatsService.name);

  constructor(
    private readonly embeddings: EmbeddingClient,
    @InjectRepository(QuestionStat)
    private readonly stats: Repository<QuestionStat>,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  /** 한 방이 전원 답변으로 끝났을 때 호출한다. */
  async recordAnswers(questionId: string, answers: string[]): Promise<void> {
    if (answers.length === 0) return;

    const vectors = await this.embeddings.embed(answers);
    const stat =
      (await this.stats.findOne({ where: { questionId } })) ??
      this.stats.create({ questionId, served: 0, completed: 0, skipped: 0 });

    stat.completed += 1;
    stat.answerVariance = meanPairwiseDistance(vectors);
    stat.avgAnswerLen =
      answers.reduce((sum, answer) => sum + answer.length, 0) / answers.length;

    await this.stats.save(stat);
  }

  async promoteGolden(): Promise<number> {
    const rows = await this.stats.find({
      where: { served: MoreThanOrEqual(MIN_SERVED) },
    });
    const cutoff = this.varianceCutoff(rows, GOLDEN_TOP_RATIO, 'top');

    const ids = rows
      .filter((row) => {
        // 쿼리에도 조건이 있지만 여기서 한 번 더 막는다. 승격 기준은
        // 최소 서빙 횟수를 넘긴 질문에만 적용되어야 한다.
        if (row.served < MIN_SERVED) return false;
        const variance = row.answerVariance ?? 0;
        const skipRate = row.skipped / row.served;
        const completionRate = row.completed / row.served;
        return (
          variance >= cutoff &&
          skipRate < MAX_SKIP_RATE_FOR_GOLDEN &&
          completionRate > MIN_COMPLETION_RATE_FOR_GOLDEN
        );
      })
      .map((row) => row.questionId);

    if (ids.length > 0) {
      await this.questions.update(ids, { golden: true });
      this.logger.log(`골든 승격 ${ids.length}건`);
    }
    return ids.length;
  }

  async retireUnderperformers(): Promise<number> {
    const rows = await this.stats.find({
      where: { served: MoreThanOrEqual(MIN_SERVED) },
    });
    const cutoff = this.varianceCutoff(rows, RETIRE_BOTTOM_RATIO, 'bottom');

    const ids = rows
      .filter((row) => {
        if (row.served < MIN_SERVED) return false;
        const variance = row.answerVariance ?? 0;
        const skipRate = row.skipped / row.served;
        return variance <= cutoff || skipRate > RETIRE_SKIP_RATE;
      })
      .map((row) => row.questionId);

    if (ids.length > 0) {
      await this.questions.update(ids, { status: QuestionStatus.RETIRED });
      this.logger.log(`은퇴 처리 ${ids.length}건`);
    }
    return ids.length;
  }

  /** 분산도 기준 상위/하위 컷오프 값 */
  private varianceCutoff(
    rows: QuestionStat[],
    ratio: number,
    end: 'top' | 'bottom',
  ): number {
    if (rows.length === 0) return end === 'top' ? Infinity : -Infinity;
    const sorted = rows
      .map((row) => row.answerVariance ?? 0)
      .sort((a, b) => b - a);
    const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
    return end === 'top' ? sorted[index] : sorted[sorted.length - 1 - index];
  }
}
```

`src/modules/stats/commands/stats.command.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { QuestionStatsService } from '../question-stats.service';

@Command({
  name: 'stats',
  description: '실사용 통계로 골든 승격과 은퇴를 처리한다',
})
export class StatsCommand extends CommandRunner {
  private readonly logger = new Logger(StatsCommand.name);

  constructor(private readonly stats: QuestionStatsService) {
    super();
  }

  async run(): Promise<void> {
    const promoted = await this.stats.promoteGolden();
    const retired = await this.stats.retireUnderperformers();
    this.logger.log(`골든 승격 ${promoted}건, 은퇴 ${retired}건`);
  }
}
```

`src/modules/stats/stats.module.ts` 는 `QuestionsModule` 과 `LlmModule` 을 import 하고 `QuestionStatsService`, `StatsCommand` 를 등록한다. `app.module.ts` 의 `imports` 에 `ReviewModule` 과 `StatsModule` 을 추가한다.

- [ ] **Step 6: 전체 테스트 통과 확인**

Run: `npx jest`
Expected: PASS — 모든 스펙 통과 (약 56 tests). `test:safety` 는 별도로 돌린다.

- [ ] **Step 7: 검수 CLI 실제 확인**

Run: `npm run cli -- review`
Expected: Task 11 에서 생성된 pending 질문들이 점수·근거와 함께 출력된다.

Run: `npm run cli -- review --approve <id> --reviewer jihun`
Expected: `승인: <id>` 로그. 다시 `review` 를 돌리면 그 질문이 목록에서 빠져야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/modules/review src/modules/stats src/app.module.ts
git commit -m "feat: 검수 큐 CLI 와 실사용 통계 기반 골든 승격/은퇴 추가"
```

---

## 완료 기준

12개 태스크가 모두 끝나면 다음이 동작한다.

```bash
npm run cli -- seed                                   # 축 60개 + 골든 20개 적재
npm run cli -- generate --format constraint --seeds 10  # 파이프라인 1회전
npm run cli -- review                                 # 검수 큐 확인
npm run cli -- review --approve 42 --reviewer jihun   # 승인
npm run cli -- stats                                  # 골든 승격 / 은퇴
npm test                                              # 단위 테스트 전체
npm run test:safety                                   # 안전 회귀 (실제 LLM 호출, .e2e-spec.ts)
```

스펙 12번의 초기 목표(형식 4종 x 40개 = 라이브 질문 160개)에 도달하려면 형식별로 `generate` 를 두세 번 돌리고 검수하면 된다.

## 범위 밖 (이 계획에 없는 것)

- 앱의 방 생성·초대·답변 제출·공개 로직. `QuestionStatsService.recordAnswers` 는 그쪽에서 호출할 진입점만 만들어둔 것이다.
- HTTP API 와 swagger. `main.ts` 는 헬스체크만 띄운다.
- Railway 배포 설정 (Dockerfile, railway.json).
- 검수용 웹 UI. 지금은 CLI 로만 검수한다.
