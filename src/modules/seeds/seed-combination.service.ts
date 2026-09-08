import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { shuffle } from 'src/common/utils/shuffle';
import { SeedCombination } from 'src/modules/questions/entities/seed-combination.entity';
import { QuestionFormat } from 'src/modules/questions/enums/question-format.enum';
import { AXIS_VALUES } from './data/axis-values';

export interface SeedCombinationDto {
  seedHash: string;
  format: QuestionFormat;
  axisValues: Record<string, string>;
}

@Injectable()
export class SeedCombinationService {
  constructor(
    @InjectRepository(SeedCombination)
    private readonly repo: Repository<SeedCombination>,
  ) {}

  buildHash(format: QuestionFormat, axisValues: Record<string, string>): string {
    const normalized = Object.keys(axisValues)
      .sort()
      .map((key) => `${key}=${axisValues[key]}`)
      .join('|');
    return createHash('sha256')
      .update(`${format}:${normalized}`)
      .digest('hex')
      .slice(0, 16);
  }

  buildAll(format: QuestionFormat): SeedCombinationDto[] {
    const axes = AXIS_VALUES[format];
    const rows =
      format === QuestionFormat.DILEMMA
        ? this.buildDilemmaRows(axes)
        : this.buildCartesianRows(axes);

    return rows.map((axisValues) => ({
      seedHash: this.buildHash(format, axisValues),
      format,
      axisValues,
    }));
  }

  async drawUnused(
    format: QuestionFormat,
    limit: number,
  ): Promise<SeedCombinationDto[]> {
    const used = await this.repo.find({
      where: { format },
      select: { seedHash: true },
    });
    const usedHashes = new Set(used.map((row) => row.seedHash));
    const unused = this.buildAll(format).filter(
      (combo) => !usedHashes.has(combo.seedHash),
    );
    // 섞은 뒤 자른다. buildAll 은 데카르트 곱을 중첩 루프 순서로 만들기 때문에
    // 그대로 slice 하면 배치 하나가 첫 번째 축 값으로 도배된다
    // (constraint 앞 9개가 전부 "시각장애 × *"). 다양성이 죽는 것은 물론이고,
    // 한 판에 같은 소재만 연달아 나오면 개별 질문이 안전 필터를 통과해도
    // 그 소재에 집착하는 앱으로 읽힌다.
    return shuffle(unused).slice(0, limit);
  }

  async markUsed(combos: SeedCombinationDto[]): Promise<void> {
    if (combos.length === 0) return;
    await this.repo.upsert(
      combos.map((combo) => ({
        seedHash: combo.seedHash,
        format: combo.format,
        axisValues: combo.axisValues,
      })),
      ['seedHash'],
    );
  }

  /** 축들의 데카르트 곱 */
  private buildCartesianRows(
    axes: Record<string, string[]>,
  ): Record<string, string>[] {
    return Object.entries(axes).reduce<Record<string, string>[]>(
      (acc, [axisName, values]) =>
        acc.flatMap((row) => values.map((value) => ({ ...row, [axisName]: value }))),
      [{}],
    );
  }

  /**
   * dilemma 는 서로 다른 괴로움 축 두 개의 비순서 조합 x 강도.
   * (A,B) 와 (B,A) 는 같은 질문이므로 한 번만 만든다.
   */
  private buildDilemmaRows(
    axes: Record<string, string[]>,
  ): Record<string, string>[] {
    const miseries = axes.miseryA;
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < miseries.length; i += 1) {
      for (let j = i + 1; j < miseries.length; j += 1) {
        for (const intensity of axes.intensity) {
          rows.push({ miseryA: miseries[i], miseryB: miseries[j], intensity });
        }
      }
    }
    return rows;
  }
}
