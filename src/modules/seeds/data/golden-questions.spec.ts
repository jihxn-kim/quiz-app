import { ALL_FORMATS } from 'src/modules/questions/enums/question-format.enum';
import { TOPIC_TAGS } from 'src/modules/generation/prompts/shared.prompt';
import { GOLDEN_QUESTIONS } from './golden-questions';

describe('GOLDEN_QUESTIONS', () => {
  it('형식당 최소 5개씩 있다', () => {
    for (const format of ALL_FORMATS) {
      const count = GOLDEN_QUESTIONS.filter((q) => q.format === format).length;
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  it('모든 질문이 물음표로 끝난다', () => {
    const bad = GOLDEN_QUESTIONS.filter((q) => !q.text.endsWith('?'));
    expect(bad).toEqual([]);
  });

  it('중복된 질문 문장이 없다', () => {
    const texts = GOLDEN_QUESTIONS.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('모든 topicTags 가 허용 목록 안에 있다', () => {
    const allowed = new Set<string>(TOPIC_TAGS);
    const invalid = GOLDEN_QUESTIONS.flatMap((q) =>
      q.topicTags.filter((tag) => !allowed.has(tag)),
    );
    expect(invalid).toEqual([]);
  });
});
