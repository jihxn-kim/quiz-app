import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RoomStatus } from '../enums/room-status.enum';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 8, unique: true })
  code!: string;

  // 순환 참조를 피하려고 스칼라로만 둔다. participants 를 관계로 걸면
  // rooms -> participants -> rooms 순환이 생겨 생성 순서가 꼬인다.
  @Column({ name: 'host_participant_id', type: 'bigint', nullable: true })
  hostParticipantId!: string | null;

  @Column({ type: 'varchar', length: 16, default: RoomStatus.WAITING })
  status!: RoomStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
