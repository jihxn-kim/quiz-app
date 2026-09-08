import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { RoundStatus } from './enums/round-status.enum';
import { QuestionPoolService } from './question-pool.service';
import { RoomService } from './room.service';

export interface RoundSubmissionResult {
  submitted: true;
  allSubmitted: boolean;
}

@Injectable()
export class RoundService {
  private readonly logger = new Logger(RoundService.name);

  constructor(
    @InjectRepository(Round) private readonly rounds: Repository<Round>,
    @InjectRepository(Answer) private readonly answers: Repository<Answer>,
    private readonly pool: QuestionPoolService,
    private readonly rooms: RoomService,
  ) {}

  async start(room: Room): Promise<{ round: Round; question: Question }> {
    const open = await this.rounds.findOne({
      where: { roomId: room.id, status: RoundStatus.OPEN },
    });
    if (open) {
      throw new ConflictException('이전 라운드가 아직 진행 중입니다');
    }

    const question = await this.pool.drawForRoom(room.id);
    const sequence = (await this.rounds.count({ where: { roomId: room.id } })) + 1;

    const round = await this.rounds.save({
      roomId: room.id,
      questionId: question.id,
      sequence,
      status: RoundStatus.OPEN,
    } as Round);

    return { round, question };
  }

  async findById(roundId: string): Promise<Round> {
    const round = await this.rounds.findOne({ where: { id: roundId } });
    if (!round) throw new NotFoundException(`라운드를 찾을 수 없습니다: ${roundId}`);
    return round;
  }

  /** 방의 가장 최근 라운드. 라운드가 하나도 없으면 null. */
  async findLatest(roomId: string): Promise<Round | null> {
    return this.rounds.findOne({ where: { roomId }, order: { sequence: 'DESC' } });
  }

  async submit(
    round: Round,
    participant: Participant,
    text: string,
  ): Promise<RoundSubmissionResult> {
    if (round.status !== RoundStatus.OPEN) {
      throw new ConflictException('이미 끝난 라운드입니다');
    }

    const existing = await this.answers.findOne({
      where: { roundId: round.id, participantId: participant.id },
    });
    if (existing) {
      throw new ConflictException('이미 제출했습니다. 수정할 수 없습니다');
    }

    await this.answers.save({
      roundId: round.id,
      participantId: participant.id,
      text,
    } as Answer);

    // 전원 제출 시 자동 공개. 별도 스케줄러 없이 여기서 전이한다.
    const [participants, submitted] = await Promise.all([
      this.rooms.listParticipants(round.roomId),
      this.answers.count({ where: { roundId: round.id } }),
    ]);

    const allSubmitted = submitted >= participants.length;
    if (allSubmitted) {
      round.status = RoundStatus.REVEALED;
      round.revealedAt = new Date();
      round.revealedBy = null;
      await this.rounds.save(round);
    }

    return { submitted: true, allSubmitted };
  }

  async reveal(round: Round, byParticipantId: string | null): Promise<Round> {
    if (round.status !== RoundStatus.OPEN) {
      throw new ConflictException('이미 끝난 라운드입니다');
    }
    round.status = RoundStatus.REVEALED;
    round.revealedAt = new Date();
    round.revealedBy = byParticipantId;
    return this.rounds.save(round);
  }

  async skip(round: Round): Promise<Round> {
    if (round.status !== RoundStatus.OPEN) {
      throw new ConflictException('이미 끝난 라운드입니다');
    }
    round.status = RoundStatus.SKIPPED;
    return this.rounds.save(round);
  }

  async listAnswers(roundId: string): Promise<Answer[]> {
    return this.answers.find({ where: { roundId }, order: { createdAt: 'ASC' } });
  }

  async submittedParticipantIds(roundId: string): Promise<Set<string>> {
    const rows = await this.answers.find({
      where: { roundId },
      select: { participantId: true },
    });
    return new Set(rows.map((row) => row.participantId));
  }
}
