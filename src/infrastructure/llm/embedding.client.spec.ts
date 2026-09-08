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
