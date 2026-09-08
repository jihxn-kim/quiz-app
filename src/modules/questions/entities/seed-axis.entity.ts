import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { QuestionFormat } from '../enums/question-format.enum';

@Entity('seed_axes')
@Unique(['format', 'axisName', 'value'])
export class SeedAxis {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  format!: QuestionFormat;

  @Column({ name: 'axis_name', type: 'varchar', length: 64 })
  axisName!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
