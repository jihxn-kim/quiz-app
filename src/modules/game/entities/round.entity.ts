import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { RoundStatus } from '../enums/round-status.enum';

@Entity('rounds')
@Unique(['roomId', 'sequence'])
@Unique(['roomId', 'questionId'])
@Index(['roomId', 'status'])
export class Round {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'room_id', type: 'bigint' })
  roomId!: string;

  @Column({ name: 'question_id', type: 'bigint' })
  questionId!: string;

  @Column({ type: 'int' })
  sequence!: number;

  @Column({ type: 'varchar', length: 16, default: RoundStatus.OPEN })
  status!: RoundStatus;

  @Column({ name: 'revealed_at', type: 'timestamptz', nullable: true })
  revealedAt!: Date | null;

  // 자동 공개면 null, 방장이 강제 공개했으면 그 참가자 id
  @Column({ name: 'revealed_by', type: 'bigint', nullable: true })
  revealedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
