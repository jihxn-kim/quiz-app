import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Question } from './question.entity';

@Entity('question_stats')
export class QuestionStat {
  @PrimaryColumn({ name: 'question_id', type: 'bigint' })
  questionId!: string;

  // questionId 컬럼에 FK 제약을 걸기 위한 관계. 실제 쓰기는 위 questionId
  // 스칼라 컬럼(PK)을 통해 이뤄지므로, 같은 컬럼에 중복 INSERT/UPDATE 가
  // 발생하지 않도록 관계 쪽은 읽기 전용으로 둔다.
  @ManyToOne(() => Question, { persistence: false })
  @JoinColumn({ name: 'question_id', referencedColumnName: 'id' })
  question?: Question;

  @Column({ type: 'int', default: 0 })
  served!: number;

  @Column({ type: 'int', default: 0 })
  completed!: number;

  @Column({ type: 'int', default: 0 })
  skipped!: number;

  @Column({ name: 'answer_variance', type: 'real', nullable: true })
  answerVariance!: number | null;

  @Column({ name: 'avg_answer_len', type: 'real', nullable: true })
  avgAnswerLen!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
