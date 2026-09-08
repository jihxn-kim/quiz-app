import { shuffle } from './shuffle';

describe('shuffle', () => {
  it('원본 배열을 변경하지 않는다', () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];

    shuffle(input);

    expect(input).toEqual(snapshot);
  });

  it('새 배열을 반환한다', () => {
    const input = [1, 2, 3];

    const result = shuffle(input);

    expect(result).not.toBe(input);
  });

  it('길이를 보존한다', () => {
    const input = [1, 2, 3, 4, 5, 6, 7];

    expect(shuffle(input)).toHaveLength(input.length);
  });

  it('원소 다중집합을 그대로 보존한다', () => {
    const input = [1, 1, 2, 3, 3, 3, 5];

    const result = shuffle(input);

    expect(result.slice().sort()).toEqual(input.slice().sort());
  });

  it('빈 배열을 그대로 처리한다', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('원소가 하나면 그대로 반환한다', () => {
    expect(shuffle(['only'])).toEqual(['only']);
  });

  it('실제로 순서를 뒤섞는다 (충분히 큰 표본으로 검증)', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);

    // 매번 입력 순서와 정확히 같게 나올 확률은 50! 분의 1에 수렴한다.
    // 몇 번 반복해서 단 한 번이라도 원래 순서와 다르면 통과 —
    // 우연히 통과 실패할 확률은 관측 가능한 수준 이하다.
    const anyDifferent = Array.from({ length: 5 }, () => shuffle(input)).some(
      (result) => result.some((value: number, i: number) => value !== input[i]),
    );

    expect(anyDifferent).toBe(true);
  });

  it('Fisher-Yates 알고리즘대로 Math.random 을 호출한다', () => {
    // Math.random 을 고정값으로 스텁해 각 스왑이 결정적으로 동작함을 검증한다.
    const input = ['a', 'b', 'c', 'd'];
    const randomSpy = jest.spyOn(Math, 'random');

    // i=3: j = floor(0 * 4) = 0 → swap(3,0): [d,b,c,a]
    // i=2: j = floor(0 * 3) = 0 → swap(2,0): [c,b,d,a]
    // i=1: j = floor(0 * 2) = 0 → swap(1,0): [b,c,d,a]
    randomSpy.mockReturnValue(0);

    const result = shuffle(input);

    expect(result).toEqual(['b', 'c', 'd', 'a']);
    expect(randomSpy).toHaveBeenCalledTimes(3);

    randomSpy.mockRestore();
  });
});
