import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';

export const FORMAT_RULES: Record<QuestionFormat, string> = {
  [QuestionFormat.CONSTRAINT]:
    '"제약" 때문에 "행위" 가 평소처럼 되지 않는 상황을 만들고, 그 상황에서 어떻게 하는지 묻는다. 제약은 상황의 전제이지 놀림거리가 아니다.',
  [QuestionFormat.DILEMMA]:
    '두 선택지가 동등하게 괴로워야 한다. 한쪽이 명백히 나으면 실패다. 두 괴로움 축과 강도를 써서 고르기 힘든 두 선택지를 만든다.',
  [QuestionFormat.PROJECTION]:
    '상황을 겪는 주인공은 답변자 본인이다. "너라면 어떻게 할래" 로 묻고, 제한 축을 걸어 답을 좁힌다.',
  [QuestionFormat.CONFESSION]:
    '답하기 부담스럽지만 답할 수는 있는 선을 지킨다. 대답 자체가 불가능한 수위는 안 된다. 금기 영역에서 자기 얘기를 하나 꺼내게 만든다.',
};

export function buildUserPrompt(args: {
  combos: { seedHash: string; axisValues: Record<string, string> }[];
  variantsPerSeed: number;
}): string {
  const lines = args.combos.map((combo, index) => {
    const axes = Object.entries(combo.axisValues)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' / ');
    return `${index + 1}. [seedHash: ${combo.seedHash}] ${axes}`;
  });

  return `아래 조합들을 각각 질문 문장으로 만들어라.
조합 하나당 서로 다른 각도로 ${args.variantsPerSeed}개씩 만든다.

${lines.join('\n')}`;
}
