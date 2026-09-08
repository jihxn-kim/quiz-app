import { EMBEDDING_DIM, EmbeddingClient } from './embedding.client';

function buildClient(create: jest.Mock): EmbeddingClient {
  const client = new EmbeddingClient({ getOrThrow: () => 'sk-test' } as never);
  (client as unknown as { openai: unknown }).openai = {
    embeddings: { create },
  };
  return client;
}

/** EMBEDDING_DIM 길이의 벡터를 만든다. 맨 앞 원소로 어떤 벡터인지 구분한다. */
function vec(...head: number[]): number[] {
  return [...head, ...Array(EMBEDDING_DIM - head.length).fill(0)];
}

describe('EmbeddingClient.embed', () => {
  it('입력 순서대로 벡터를 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: vec(0, 1) },
        { index: 0, embedding: vec(1, 0) },
      ],
    });
    await expect(buildClient(create).embed(['a', 'b'])).resolves.toEqual([
      vec(1, 0),
      vec(0, 1),
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
        embedding: vec(Number(text)),
      })),
    }));
    const texts = Array.from({ length: 150 }, (_, i) => String(i));

    const result = await buildClient(create).embed(texts);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
    expect(result[0]).toEqual(vec(0));
    expect(result[149]).toEqual(vec(149));
  });

  describe('재시도', () => {
    it('일시적 실패는 재시도하고 성공하면 결과를 돌려준다', async () => {
      const create = jest
        .fn()
        .mockRejectedValueOnce(new Error('503'))
        .mockResolvedValue({ data: [{ index: 0, embedding: vec(1) }] });

      const result = await buildClient(create).embed(['a']);

      expect(result).toEqual([vec(1)]);
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('재시도를 모두 소진하면 마지막 에러를 던진다', async () => {
      const create = jest.fn().mockRejectedValue(new Error('계속 실패'));

      await expect(buildClient(create).embed(['a'])).rejects.toThrow('계속 실패');
      expect(create).toHaveBeenCalledTimes(3);
    });

    it('한 배치가 재시도해도 이미 성공한 배치는 다시 보내지 않는다', async () => {
      const texts = Array.from({ length: 150 }, (_, i) => String(i));
      let callCount = 0;
      const create = jest.fn().mockImplementation(({ input }: { input: string[] }) => {
        callCount += 1;
        // 두 번째 배치(콜 순서 2번째)의 첫 시도만 실패시킨다.
        if (callCount === 2) {
          return Promise.reject(new Error('일시적 오류'));
        }
        return Promise.resolve({
          data: input.map((text, index) => ({ index, embedding: vec(Number(text)) })),
        });
      });

      const result = await buildClient(create).embed(texts);

      expect(result).toHaveLength(150);
      // 첫 배치 1회 + 둘째 배치(실패 1회 + 성공 1회) = 총 3회
      expect(create).toHaveBeenCalledTimes(3);
      // 첫 배치(0~99)의 입력은 정확히 한 번만 전송됐다 — 재전송되지 않았다.
      const firstBatchCalls = create.mock.calls.filter(
        ([arg]) => (arg as { input: string[] }).input[0] === '0',
      );
      expect(firstBatchCalls).toHaveLength(1);
    }, 10_000);
  });

  describe('응답 검증', () => {
    it('응답 벡터 개수가 요청보다 적으면 undefined 구멍을 만들지 않고 에러를 던진다', async () => {
      const create = jest.fn().mockResolvedValue({
        data: [{ index: 0, embedding: vec(1) }], // 2개 요청했는데 1개만 옴
      });

      await expect(buildClient(create).embed(['a', 'b'])).rejects.toThrow(/개수/);
    }, 10_000);

    it('벡터 차원이 EMBEDDING_DIM 과 다르면 에러를 던진다', async () => {
      const create = jest.fn().mockResolvedValue({
        data: [{ index: 0, embedding: [1, 2, 3] }],
      });

      await expect(buildClient(create).embed(['a'])).rejects.toThrow(/벡터 길이/);
    }, 10_000);
  });
});
