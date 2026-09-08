import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('participants')
@Unique(['roomId', 'nickname'])
export class Participant {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'room_id', type: 'bigint' })
  roomId!: string;

  @Column({ type: 'varchar', length: 20 })
  nickname!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token!: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;
}
