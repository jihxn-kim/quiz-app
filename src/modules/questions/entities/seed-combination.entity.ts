import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';

@Entity('seed_combinations')
export class SeedCombination {
  @PrimaryColumn({ name: 'seed_hash', type: 'varchar', length: 16 })
  seedHash!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'axis_values', type: 'jsonb' })
  axisValues!: Record<string, string>;

  @CreateDateColumn({ name: 'used_at', type: 'timestamptz' })
  usedAt!: Date;
}
