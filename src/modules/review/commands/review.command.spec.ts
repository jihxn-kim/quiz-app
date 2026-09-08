import { Logger } from '@nestjs/common';
import { Question } from 'src/modules/questions/entities/question.entity';
import { ReviewCommand } from './review.command';

const question = (overrides: Partial<Question> = {}) =>
  ({
    id: '1',
    text: '질문?',
    judgeScores: null,
    safetyPassed: null,
    safetyReason: null,
    ...overrides,
  }) as Question;

describe('ReviewCommand', () => {
  const review = {
    approve: jest.fn(),
    reject: jest.fn(),
    publish: jest.fn(),
    listPending: jest.fn(),
    countApproved: jest.fn(),
  };
  let command: ReviewCommand;
  let logSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    review.countApproved.mockResolvedValue(0);
    command = new ReviewCommand(review as never);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    loggerLogSpy.mockRestore();
  });

  it('안전 판정이 null 인 질문도 "미판정"으로 안전 줄을 표시한다 (통과와 다르게)', async () => {
    review.listPending.mockResolvedValue([
      question({ id: '1', safetyPassed: null, safetyReason: null }),
    ]);

    await command.run([], { reviewer: 'jihun' });

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('안전: 미판정');
    expect(output).toContain('반드시 사람이 판단');
  });

  it('안전 통과와 미판정을 서로 다른 문구로 구분한다', async () => {
    review.listPending.mockResolvedValue([
      question({ id: '1', safetyPassed: null }),
      question({ id: '2', safetyPassed: true, safetyReason: '이상 없음' }),
    ]);

    await command.run([], { reviewer: 'jihun' });

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('안전: 미판정');
    expect(output).toContain('안전: 통과 (이상 없음)');
    // 미판정과 통과는 서로 다른 줄이어야 한다 (동일하게 렌더링되면 안 됨)
    const safetyLines = output.split('\n').filter((line) => line.includes('안전:'));
    expect(new Set(safetyLines).size).toBe(2);
  });

  it('안전 탈락도 사유와 함께 표시한다', async () => {
    review.listPending.mockResolvedValue([
      question({ id: '3', safetyPassed: false, safetyReason: '조롱 톤' }),
    ]);

    await command.run([], { reviewer: 'jihun' });

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('안전: 탈락 (조롱 톤)');
  });

  it('approve 가 에러를 던지면 승인 성공 로그를 찍지 않고 에러를 그대로 전파한다', async () => {
    review.approve.mockRejectedValue(new Error('질문 999 은(는) 검수 대기 상태가 아닙니다'));

    await expect(
      command.run([], { approve: '999', reviewer: 'jihun' }),
    ).rejects.toThrow('검수 대기 상태가 아닙니다');

    expect(loggerLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('승인:'));
  });

  it('--publish 는 쉼표로 구분된 id 들을 배포한다', async () => {
    await command.run([], { publish: '3,7,11', reviewer: 'jihun' });
    expect(review.publish).toHaveBeenCalledWith(['3', '7', '11']);
  });

  it('--publish 는 공백을 무시한다', async () => {
    await command.run([], { publish: ' 3 , 7 ', reviewer: 'jihun' });
    expect(review.publish).toHaveBeenCalledWith(['3', '7']);
  });
});
