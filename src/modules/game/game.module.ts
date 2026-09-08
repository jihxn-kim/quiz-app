import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { ParticipantGuard } from './auth/participant.guard';
import { RoomService } from './room.service';
import { QuestionsModule } from 'src/modules/questions/questions.module';
import { QuestionPoolService } from './question-pool.service';

const ENTITIES = [Room, Participant, Round, Answer];

@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), QuestionsModule],
  providers: [ParticipantGuard, RoomService, QuestionPoolService],
  exports: [TypeOrmModule, ParticipantGuard, RoomService, QuestionPoolService],
})
export class GameModule {}
