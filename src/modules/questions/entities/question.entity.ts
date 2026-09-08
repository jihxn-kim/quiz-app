import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';
import { QuestionStatus } from '../enums/question-status.enum';

export interface JudgeScores {
  variance: number;
  accessibility: number;
  concreteness: number;
  curiosity: number;
  reason: string;
}

@Entity('questions')
@Index(['status', 'format'])
export class Question {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'topic_tags', type: 'text', array: true, default: () => "'{}'" })
  topicTags!: string[];

  @Column({ name: 'seed_hash', type: 'varchar', length: 16, nullable: true })
  seedHash!: string | null;

  @Column({ type: 'real', array: true, nullable: true })
  embedding!: number[] | null;

  @Column({ name: 'judge_scores', type: 'jsonb', nullable: true })
  judgeScores!: JudgeScores | null;

  @Column({ name: 'safety_passed', type: 'boolean', nullable: true })
  safetyPassed!: boolean | null;

  @Column({ name: 'safety_reason', type: 'text', nullable: true })
  safetyReason!: string | null;

  @Column({ type: 'varchar', length: 16, default: QuestionStatus.PENDING })
  status!: QuestionStatus;

  @Column({ type: 'boolean', default: false })
  golden!: boolean;

  @Column({ name: 'batch_id', type: 'varchar', length: 64, nullable: true })
  batchId!: string | null;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 64, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
