import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';

export const AXIS_VALUES: Record<QuestionFormat, Record<string, string[]>> = {
  [QuestionFormat.CONSTRAINT]: {
    constraintAxis: [
      '시각장애',
      '청각장애',
      '손이 하나뿐',
      '말을 못 함',
      '기억이 10분만 유지됨',
      '무중력 상태',
      '물이 전혀 없음',
      '남들이 내 생각을 들을 수 있음',
      '몸이 30cm 로 작아짐',
      '거짓말을 할 수 없음',
    ],
    activityAxis: [
      '배변 후 뒤처리',
      '샤워',
      '라면 끓이기',
      '이별 통보',
      '지하철 타기',
      '소개팅',
      '장례식 참석',
      '면접',
      '병원 진료',
    ],
  },
  [QuestionFormat.DILEMMA]: {
    miseryA: [
      '프라이버시 상실',
      '신체 불편',
      '사회적 평판',
      '시간 낭비',
      '관계 단절',
      '감각 상실',
      '자유 제한',
    ],
    miseryB: [
      '프라이버시 상실',
      '신체 불편',
      '사회적 평판',
      '시간 낭비',
      '관계 단절',
      '감각 상실',
      '자유 제한',
    ],
    intensity: ['평생', '1년', '하루에 1시간'],
  },
  [QuestionFormat.PROJECTION]: {
    scenarioAxis: [
      '시한부 통보',
      '로또 당첨',
      '무인도 표류',
      '시간여행',
      '투명인간',
      '과거로 편지',
      '다른 사람 몸',
    ],
    limitAxis: ['딱 하나만', '딱 한 명만', '24시간 안에', '아무도 모르게'],
  },
  [QuestionFormat.CONFESSION]: {
    tabooAxis: [
      '거짓말',
      '질투',
      '돈',
      '성적 취향',
      '가족에 대한 감정',
      '친구에 대한 속마음',
      '후회',
      '몰래 한 행동',
    ],
  },
};

/** 형식별로 시드 하나당 요청할 변형 개수 */
export const VARIANTS_PER_SEED: Record<QuestionFormat, number> = {
  [QuestionFormat.CONSTRAINT]: 3,
  [QuestionFormat.DILEMMA]: 3,
  [QuestionFormat.PROJECTION]: 3,
  [QuestionFormat.CONFESSION]: 10,
};
