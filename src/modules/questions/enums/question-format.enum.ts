export enum QuestionFormat {
  CONSTRAINT = 'constraint',
  DILEMMA = 'dilemma',
  PROJECTION = 'projection',
  CONFESSION = 'confession',
}

export const ALL_FORMATS: QuestionFormat[] = [
  QuestionFormat.CONSTRAINT,
  QuestionFormat.DILEMMA,
  QuestionFormat.PROJECTION,
  QuestionFormat.CONFESSION,
];
