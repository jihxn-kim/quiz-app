export const JUDGE_SYSTEM_PROMPT = `너는 친구들끼리 하는 질문 게임의 질문을 심사한다.
이 게임은 모두가 각자 답을 적고, 전원 제출 후 서로의 답을 동시에 공개한다.

각 질문을 아래 4개 항목에 대해 0~5점으로 채점한다.

| 항목 | 판정 질문 |
|---|---|
| variance | 10명이 답하면 서로 다르게 답할까? 정답이 뻔하면 0점 |
| accessibility | 전문 지식 없이 누구나 답할 수 있나? |
| concreteness | 상황이 구체적인가, 추상적 철학인가? |
| curiosity | 남의 답이 궁금해지나? |

variance 가 가장 중요하다. 전원이 답해야 공개되는 게임인데
모두 같은 답을 하면 공개되는 순간이 재미없다.

reason 에는 점수의 근거를 한 문장으로 적는다.
index 는 입력에서 받은 번호를 그대로 적는다.
입력으로 받은 모든 질문을 빠짐없이 채점한다.`;

export function buildJudgeUserPrompt(texts: string[]): string {
  return `아래 질문들을 채점해라.\n\n${texts
    .map((text, index) => `${index}. ${text}`)
    .join('\n')}`;
}
