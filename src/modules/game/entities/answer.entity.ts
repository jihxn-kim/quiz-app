import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('answers')
@Unique(['roundId', 'participantId'])
@Index(['roundId'])
export class Answer {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'round_id', type: 'bigint' })
  roundId!: string;

  @Column({ name: 'participant_id', type: 'bigint' })
  participantId!: string;

  @Column({ type: 'text' })
  text!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
