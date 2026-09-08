import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LlmClient } from 'src/infrastructure/llm/llm.client';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { QuestionGeneratorService } from './question-generator.service';

const COMBOS = Array.from({ length: 25 }, (_, i) => ({
  seedHash: `hash${i}`,
  format: QuestionFormat.CONSTRAINT,
  axisValues: { constraintAxis: `제약${i}`, activityAxis: `행위${i}` },
}));

describe('QuestionGeneratorService', () => {
  let service: QuestionGeneratorService;
  const llm = { completeJson: jest.fn() };
  const questionRepo = { find: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    questionRepo.find.mockResolvedValue([
      { text: '골든 질문 1?' },
      { text: '골든 질문 2?' },
      { text: '골든 질문 3?' },
      { text: '골든 질문 4?' },
      { text: '골든 질문 5?' },
      { text: '골든 질문 6?' },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionGeneratorService,
        { provide: LlmClient, useValue: llm },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
      ],
    }).compile();
    service = moduleRef.get(QuestionGeneratorService);
  });

  it('시드를 10개씩 나눠 호출한다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    expect(llm.completeJson).toHaveBeenCalledTimes(3); // 10 + 10 + 5
  });

  it('모든 호출 결과를 합쳐서 반환한다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [{ text: '질문?', topicTags: ['신체생리'], seedHash: 'hash0' }],
    });

    const result = await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    expect(result).toHaveLength(3);
  });

  it('골든 예시를 5개까지만 프롬프트에 넣는다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.generate(QuestionFormat.CONSTRAINT, COMBOS.slice(0, 1), 3);

    const { system } = llm.completeJson.mock.calls[0][0];
    const exampleCount = (system.match(/골든 질문/g) ?? []).length;
    expect(exampleCount).toBeLessThanOrEqual(5);
    expect(exampleCount).toBeGreaterThan(0);
  });

  it('요청마다 골든 예시를 다시 샘플링한다', async () => {
    llm.completeJson.mockResolvedValue({ items: [] });

    await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    // 같은 호출에서 재사용된 배열 참조가 아니라 매번 새로 뽑는지 확인
    expect(questionRepo.find).toHaveBeenCalledTimes(1);
    const systems = llm.completeJson.mock.calls.map((call) => call[0].system);
    expect(new Set(systems).size).toBeGreaterThanOrEqual(1);
  });

  it('입력에 없는 seedHash 가 돌아오면 버린다', async () => {
    llm.completeJson.mockResolvedValue({
      items: [
        { text: '정상?', topicTags: ['연애'], seedHash: 'hash0' },
        { text: '유령?', topicTags: ['연애'], seedHash: '없는해시' },
      ],
    });

    const result = await service.generate(
      QuestionFormat.CONSTRAINT,
      COMBOS.slice(0, 1),
      3,
    );

    expect(result).toHaveLength(1);
    expect(result[0].seedHash).toBe('hash0');
  });

  it('한 요청이 실패해도 나머지 결과를 살린다', async () => {
    llm.completeJson
      .mockRejectedValueOnce(new Error('LLM 실패'))
      .mockResolvedValue({
        items: [{ text: '질문?', topicTags: ['돈'], seedHash: 'hash10' }],
      });

    const result = await service.generate(QuestionFormat.CONSTRAINT, COMBOS, 3);

    expect(result).toHaveLength(2);
  });

  it('빈 조합이면 LLM 을 호출하지 않는다', async () => {
    await expect(
      service.generate(QuestionFormat.CONSTRAINT, [], 3),
    ).resolves.toEqual([]);
    expect(llm.completeJson).not.toHaveBeenCalled();
  });
});
