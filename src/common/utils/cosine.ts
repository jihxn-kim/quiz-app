export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`벡터 길이가 다릅니다: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 답변 분산도. 모든 쌍의 코사인 거리(1 - 유사도) 평균.
 * 값이 클수록 답변이 서로 다르다 = 좋은 질문.
 */
export function meanPairwiseDistance(vectors: number[][]): number {
  if (vectors.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      total += 1 - cosineSimilarity(vectors[i], vectors[j]);
      pairs += 1;
    }
  }
  return total / pairs;
}
