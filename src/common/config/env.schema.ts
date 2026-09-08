import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // 없으면 main.ts 가 3000 을 기본값으로 쓴다.
  PORT: z.coerce.number().int().positive().optional(),
  // 콤마로 구분된 허용 오리진 목록. 없으면 전체 허용(app.enableCors 의 기본
  // 동작) — 로컬 개발에서는 안 채워도 되지만 배포 환경에는 채워야 한다.
  CORS_ORIGINS: z.string().optional(),
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
