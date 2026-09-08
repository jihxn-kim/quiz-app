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
