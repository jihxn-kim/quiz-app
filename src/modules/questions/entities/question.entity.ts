import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';
import { QuestionStatus } from '../enums/question-status.enum';
import { SeedCombination } from './seed-combination.entity';

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

  // seedHash 컬럼에 FK 제약을 걸기 위한 관계. 실제 쓰기는 위 seedHash
  // 스칼라 컬럼을 통해 이뤄지므로, 같은 컬럼에 중복 INSERT/UPDATE 가
  // 발생하지 않도록 관계 쪽은 읽기 전용으로 둔다.
  @ManyToOne(() => SeedCombination, { nullable: true, persistence: false })
  @JoinColumn({ name: 'seed_hash', referencedColumnName: 'seedHash' })
  seedCombination?: SeedCombination | null;

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
