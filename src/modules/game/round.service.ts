import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class RoundService {
  private readonly logger = new Logger(RoundService.name);

  constructor(
    @InjectRepository(Round) private readonly rounds: Repository<Round>,
    @InjectRepository(Answer) private readonly answers: Repository<Answer>,
    private readonly pool: QuestionPoolService,
    private readonly rooms: RoomService,
    private readonly dataSource: DataSource,
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
    if (participant.roomId !== round.roomId) {
      throw new ForbiddenException('이 방의 참가자가 아닙니다');
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Round, {
        where: { id: round.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`라운드를 찾을 수 없습니다: ${round.id}`);
      if (locked.status !== RoundStatus.OPEN) {
        throw new ConflictException('이미 끝난 라운드입니다');
      }

      const existing = await manager.findOne(Answer, {
        where: { roundId: locked.id, participantId: participant.id },
      });
      if (existing) {
        throw new ConflictException('이미 제출했습니다. 수정할 수 없습니다');
      }

      try {
        await manager.save(Answer, {
          roundId: locked.id,
          participantId: participant.id,
          text,
        } as Answer);
      } catch (error) {
        if ((error as { driverError?: { code?: string } }).driverError?.code === POSTGRES_UNIQUE_VIOLATION) {
          throw new ConflictException('이미 제출했습니다. 수정할 수 없습니다');
        }
        throw error;
      }

      // 전원 제출 시 자동 공개. 별도 스케줄러 없이 여기서 전이한다.
      const [participants, submitted] = await Promise.all([
        this.rooms.listParticipants(locked.roomId),
        manager.count(Answer, { where: { roundId: locked.id } }),
      ]);

      const allSubmitted = submitted >= participants.length;
      if (allSubmitted) {
        locked.status = RoundStatus.REVEALED;
        locked.revealedAt = new Date();
        locked.revealedBy = null;
        await manager.save(Round, locked);
      }

      return { submitted: true, allSubmitted };
    });
  }

  async reveal(round: Round, byParticipantId: string | null): Promise<Round> {
    const revealedAt = new Date();
    const result = await this.rounds.update(
      { id: round.id, status: RoundStatus.OPEN },
      { status: RoundStatus.REVEALED, revealedAt, revealedBy: byParticipantId },
    );
    if (result.affected === 0) {
      throw new ConflictException('이미 끝난 라운드입니다');
    }
    return this.findById(round.id);
  }

  async skip(round: Round): Promise<Round> {
    const result = await this.rounds.update(
      { id: round.id, status: RoundStatus.OPEN },
      { status: RoundStatus.SKIPPED },
    );
    if (result.affected === 0) {
      throw new ConflictException('이미 끝난 라운드입니다');
    }
    return this.findById(round.id);
  }

  /** 공개된 라운드의 답변만 반환한다. 열린 라운드에 부르면 거부한다. */
  async listAnswers(round: Round): Promise<Answer[]> {
    if (round.status === RoundStatus.OPEN) {
      throw new ConflictException('아직 공개되지 않은 라운드입니다');
    }
    return this.answers.find({ where: { roundId: round.id }, order: { createdAt: 'ASC' } });
  }

  /** 내 답변 한 건. 미제출이면 null. 열린 라운드에서도 안전하다. */
  async findMyAnswer(roundId: string, participantId: string): Promise<Answer | null> {
    return this.answers.findOne({ where: { roundId, participantId } });
  }

  async submittedParticipantIds(roundId: string): Promise<Set<string>> {
    const rows = await this.answers.find({
      where: { roundId },
      select: { participantId: true },
    });
    return new Set(rows.map((row) => row.participantId));
  }
}
