import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pw@host:5432/db',
    ANTHROPIC_API_KEY: 'sk-ant-test',
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

  it('ANTHROPIC_API_KEY 가 빈 문자열이면 에러를 던진다', () => {
    expect(() => validateEnv({ ...valid, ANTHROPIC_API_KEY: '' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});
