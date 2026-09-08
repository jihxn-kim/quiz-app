import { QuestionFormat, ALL_FORMATS } from '../enums/question-format.enum';
import { QuestionStatus } from '../enums/question-status.enum';

describe('질문 열거형', () => {
  it('형식 4종을 모두 노출한다', () => {
    expect(ALL_FORMATS).toHaveLength(4);
    expect(ALL_FORMATS).toEqual([
      QuestionFormat.CONSTRAINT,
      QuestionFormat.DILEMMA,
      QuestionFormat.PROJECTION,
      QuestionFormat.CONFESSION,
    ]);
  });

  it('상태 5종을 노출한다', () => {
    expect(Object.values(QuestionStatus)).toEqual([
      'pending',
      'approved',
      'live',
      'rejected',
      'retired',
    ]);
  });
});
