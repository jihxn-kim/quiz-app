import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';

@Entity('generation_batches')
export class GenerationBatch {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'seed_count', type: 'int' })
  seedCount!: number;

  @Column({ type: 'int', default: 0 })
  generated!: number;

  @Column({ type: 'int', default: 0 })
  deduped!: number;

  @Column({ name: 'judge_passed', type: 'int', default: 0 })
  judgePassed!: number;

  @Column({ name: 'safety_passed', type: 'int', default: 0 })
  safetyPassed!: number;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
