/**
 * Fisher-Yates 셔플. 원본을 건드리지 않고 새 배열을 돌려준다.
 *
 * `sort(() => Math.random() - 0.5)` 를 쓰지 않는 이유: 비교자가 일관성 계약을
 * 어겨서 엔진의 정렬 구현에 따라 결과가 균등하지 않게 치우친다.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
