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
