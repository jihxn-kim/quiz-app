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
    it('형식별 조합 수가 고정값과 일치한다', () => {
      expect(service.buildAll(QuestionFormat.CONSTRAINT)).toHaveLength(90);
      expect(service.buildAll(QuestionFormat.DILEMMA)).toHaveLength(63);
      expect(service.buildAll(QuestionFormat.PROJECTION)).toHaveLength(28);
      expect(service.buildAll(QuestionFormat.CONFESSION)).toHaveLength(8);
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

    it('confession 은 축이 하나여도 조합을 만든다', () => {
      const combos = service.buildAll(QuestionFormat.CONFESSION);
      expect(combos).toHaveLength(8);
      for (const combo of combos) {
        expect(Object.keys(combo.axisValues)).toEqual(['tabooAxis']);
        expect(combo.axisValues.tabooAxis).toBeTruthy();
      }
      expect(new Set(combos.map((c) => c.seedHash)).size).toBe(8);
    });

    it('projection 은 상황 x 제한 전조합을 만든다', () => {
      const combos = service.buildAll(QuestionFormat.PROJECTION);
      expect(combos).toHaveLength(28);
      for (const combo of combos) {
        expect(Object.keys(combo.axisValues).sort()).toEqual(['limitAxis', 'scenarioAxis']);
      }
      expect(new Set(combos.map((c) => c.seedHash)).size).toBe(28);
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

    it('셔플되어 한 축 값으로 도배되지 않는다', async () => {
      // buildAll 은 데카르트 곱을 중첩 루프 순서로 만들어서, constraint 축
      // 90개 조합 중 앞 9개는 전부 constraintAxis 가 같은 값이다(첫 값 x
      // activity 9개). 셔플 없이 그대로 slice(0, 8) 하면 8개 전부 같은
      // constraintAxis 값 하나로만 채워진다. 셔플하면 10개 값에 걸쳐 퍼진
      // 90개 중 8개를 뽑으므로 전부 한 값일 확률은 사실상 0이다.
      repo.find.mockResolvedValue([]);

      const drawn = await service.drawUnused(QuestionFormat.CONSTRAINT, 8);

      const distinctConstraints = new Set(
        drawn.map((c) => c.axisValues.constraintAxis),
      );
      expect(distinctConstraints.size).toBeGreaterThan(1);
    });
  });

  describe('markUsed', () => {
    it('빈 배열이면 저장소를 건드리지 않는다', async () => {
      await service.markUsed([]);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('seedHash 를 충돌 키로 upsert 한다', async () => {
      const combos = service.buildAll(QuestionFormat.CONSTRAINT).slice(0, 2);

      await service.markUsed(combos);

      const [rows, conflictKeys] = repo.upsert.mock.calls[0];
      expect(conflictKeys).toEqual(['seedHash']);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        seedHash: combos[0].seedHash,
        format: QuestionFormat.CONSTRAINT,
        axisValues: combos[0].axisValues,
      });
    });
  });
});
