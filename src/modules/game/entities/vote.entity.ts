import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('votes')
@Unique(['roundId', 'voterParticipantId'])
@Index(['roundId'])
export class Vote {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'round_id', type: 'bigint' })
  roundId!: string;

  // 누가 던진 표인지. 결과 화면에는 절대 나가지 않는다 — 득표 수만 공개한다.
  @Column({ name: 'voter_participant_id', type: 'bigint' })
  voterParticipantId!: string;

  @Column({ name: 'answer_id', type: 'bigint' })
  answerId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
