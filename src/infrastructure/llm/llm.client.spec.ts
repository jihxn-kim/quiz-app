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
