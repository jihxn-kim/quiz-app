import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('question_stats')
export class QuestionStat {
  @PrimaryColumn({ name: 'question_id', type: 'bigint' })
  questionId!: string;

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
