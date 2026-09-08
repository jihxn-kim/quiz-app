import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { ParticipantGuard } from './auth/participant.guard';
import { RoomService } from './room.service';

const ENTITIES = [Room, Participant, Round, Answer];

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [ParticipantGuard, RoomService],
  exports: [TypeOrmModule, ParticipantGuard, RoomService],
})
export class GameModule {}
