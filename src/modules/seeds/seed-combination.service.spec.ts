import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SeedCombination } from 'src/modules/questions/entities/seed-combination.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { AXIS_VALUES } from './data/axis-values';
import { SeedCombinationService } from './seed-combination.service';

describe('SeedCombinationService', () => {
  let service: SeedCombinationService;
  const repo = { find: jest.fn(), upsert: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SeedCombinationService,
        { provide: getRepositoryToken(SeedCombination), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(SeedCombinationService);
  });

  describe('buildHash', () => {
    it('16자 해시를 만든다', () => {
      const hash = service.buildHash(QuestionFormat.CONSTRAINT, {
        constraintAxis: '시각장애',
        activityAxis: '배변 후 뒤처리',
      });
      expect(hash).toHaveLength(16);
    });

    it('축 값의 키 순서가 달라도 같은 해시를 만든다', () => {
      const a = service.buildHash(QuestionFormat.CONSTRAINT, {
        constraintAxis: '시각장애',
        activityAxis: '배변 후 뒤처리',
      });
      const b = service.buildHash(QuestionFormat.CONSTRAINT, {
        activityAxis: '배변 후 뒤처리',
        constraintAxis: '시각장애',
      });
      expect(a).toBe(b);
    });

    it('형식이 다르면 다른 해시를 만든다', () => {
      const values = { a: 'x', b: 'y' };
      expect(service.buildHash(QuestionFormat.CONSTRAINT, values)).not.toBe(
        service.buildHash(QuestionFormat.DILEMMA, values),
      );
    });
  });

  describe('buildAll', () => {
    it('constraint 는 제약 x 행위 전조합을 만든다', () => {
      const combos = service.buildAll(QuestionFormat.CONSTRAINT);
      const axes = AXIS_VALUES[QuestionFormat.CONSTRAINT];
      const expected =
        axes.constraintAxis.length * axes.activityAxis.length;
      expect(combos).toHaveLength(expected);
    });

    it('중복 해시를 만들지 않는다', () => {
      const combos = service.buildAll(QuestionFormat.CONSTRAINT);
      expect(new Set(combos.map((c) => c.seedHash)).size).toBe(combos.length);
    });

    it('dilemma 는 서로 다른 괴로움 축 두 개를 짝짓는다', () => {
      const combos = service.buildAll(QuestionFormat.DILEMMA);
      for (const combo of combos) {
        expect(combo.axisValues.miseryA).not.toBe(combo.axisValues.miseryB);
      }
    });
  });

  describe('drawUnused', () => {
    it('이미 사용된 해시를 제외하고 반환한다', async () => {
      const all = service.buildAll(QuestionFormat.CONSTRAINT);
      const usedHash = all[0].seedHash;
      repo.find.mockResolvedValue([{ seedHash: usedHash }]);

      const drawn = await service.drawUnused(QuestionFormat.CONSTRAINT, 5);

      expect(drawn).toHaveLength(5);
      expect(drawn.map((c) => c.seedHash)).not.toContain(usedHash);
    });

    it('남은 조합이 limit 보다 적으면 남은 만큼만 반환한다', async () => {
      const all = service.buildAll(QuestionFormat.CONSTRAINT);
      repo.find.mockResolvedValue(all.slice(0, all.length - 2).map((c) => ({ seedHash: c.seedHash })));

      const drawn = await service.drawUnused(QuestionFormat.CONSTRAINT, 10);

      expect(drawn).toHaveLength(2);
    });

    it('모든 조합이 소진되면 빈 배열을 반환한다', async () => {
      const all = service.buildAll(QuestionFormat.CONSTRAINT);
      repo.find.mockResolvedValue(all.map((c) => ({ seedHash: c.seedHash })));

      await expect(
        service.drawUnused(QuestionFormat.CONSTRAINT, 5),
      ).resolves.toEqual([]);
    });
  });
});
