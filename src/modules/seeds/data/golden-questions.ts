import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';

export interface GoldenQuestion {
  text: string;
  format: QuestionFormat;
  topicTags: string[];
}

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  // constraint — 1번이 이 프로젝트의 기준 질문
  { text: '시각장애인은 변을 보고 닦을 때 다 닦였는지 어떻게 확인할까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '청각장애인은 자기가 코를 고는지 어떻게 알까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '한쪽 손만 쓸 수 있으면 신발끈은 어떻게 묶을까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '말을 못 하면 응급실에서 어디가 아픈지 어떻게 전달할까?', format: QuestionFormat.CONSTRAINT, topicTags: ['신체생리'] },
  { text: '무중력에서 라면을 끓이면 국물은 어떻게 먹을까?', format: QuestionFormat.CONSTRAINT, topicTags: ['음식', '비현실상황'] },

  // dilemma
  { text: '평생 남의 속마음이 들리는 것과 내 속마음이 다 들리는 것 중 뭐가 나을까?', format: QuestionFormat.DILEMMA, topicTags: ['사회적금기'] },
  { text: '평생 라면만 먹기와 평생 김밥만 먹기 중 뭐를 고를까?', format: QuestionFormat.DILEMMA, topicTags: ['음식'] },
  { text: '친구가 하나도 없는 부자와 친구는 많은 가난뱅이 중 뭐가 나을까?', format: QuestionFormat.DILEMMA, topicTags: ['돈', '친구관계'] },
  { text: '하루에 한 시간씩 남의 몸으로 사는 것과 일 년에 한 달 기억을 잃는 것 중 뭘 고를까?', format: QuestionFormat.DILEMMA, topicTags: ['비현실상황'] },
  { text: '평생 앉을 수 없는 것과 평생 누울 수 없는 것 중 뭐가 나을까?', format: QuestionFormat.DILEMMA, topicTags: ['신체생리'] },

  // projection
  { text: '내일 지구가 끝나면 오늘 밤 누구한테 전화할까?', format: QuestionFormat.PROJECTION, topicTags: ['죽음', '친구관계'] },
  { text: '투명인간이 되면 아무도 모르게 제일 먼저 뭘 할까?', format: QuestionFormat.PROJECTION, topicTags: ['비현실상황'] },
  { text: '무인도에 딱 하나만 가져갈 수 있으면 뭘 가져갈까?', format: QuestionFormat.PROJECTION, topicTags: ['비현실상황'] },
  { text: '과거의 나한테 편지를 한 통만 보낼 수 있으면 몇 살의 나한테 보낼까?', format: QuestionFormat.PROJECTION, topicTags: ['후회'] },
  { text: '로또에 당첨되면 24시간 안에 제일 먼저 뭘 할까?', format: QuestionFormat.PROJECTION, topicTags: ['돈'] },

  // confession
  { text: '부모님한테 끝까지 숨긴 것 하나만 말한다면?', format: QuestionFormat.CONFESSION, topicTags: ['가족'] },
  { text: '친구한테 질투 느낀 순간이 언제였을까?', format: QuestionFormat.CONFESSION, topicTags: ['친구관계'] },
  { text: '마지막으로 한 거짓말은 뭐였을까?', format: QuestionFormat.CONFESSION, topicTags: ['사회적금기'] },
  { text: '돈 때문에 포기한 것 중에 제일 아까운 게 뭘까?', format: QuestionFormat.CONFESSION, topicTags: ['돈'] },
  { text: '아무한테도 말 안 한 후회가 하나 있다면?', format: QuestionFormat.CONFESSION, topicTags: ['후회'] },
];
