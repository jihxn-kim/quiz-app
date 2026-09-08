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

  it('I7: PORT/CORS_ORIGINS 이 없어도 통과한다 (둘 다 선택 항목)', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBeUndefined();
    expect(env.CORS_ORIGINS).toBeUndefined();
  });

  it('I7: PORT 를 숫자로 강제 변환한다', () => {
    const env = validateEnv({ ...valid, PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('I7: CORS_ORIGINS 는 콤마로 구분된 문자열 그대로 통과한다', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: 'https://a.example.com,https://b.example.com',
    });
    expect(env.CORS_ORIGINS).toBe('https://a.example.com,https://b.example.com');
  });
});
