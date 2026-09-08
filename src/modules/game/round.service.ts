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
import { QuestionStatsService } from 'src/modules/stats/question-stats.service';
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
    private readonly stats: QuestionStatsService,
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

    await this.recordQuietly(() => this.stats.recordServed(question.id), 'served');

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

    const result = await this.dataSource.transaction<RoundSubmissionResult>(async (manager) => {
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

    // 트랜잭션 커밋 후에 통계를 기록한다. 트랜잭션 안에서 부르면 listAnswers 가
    // 다른 커넥션으로 읽어 방금 커밋되지 않은 마지막 답변을 못 보고, 행 잠금도
    // 통계 기록 동안 계속 잡고 있게 된다.
    if (result.allSubmitted) {
      await this.recordRevealed(await this.findById(round.id));
    }

    return result;
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
    const revealed = await this.findById(round.id);
    await this.recordRevealed(revealed);
    return revealed;
  }

  async skip(round: Round): Promise<Round> {
    const result = await this.rounds.update(
      { id: round.id, status: RoundStatus.OPEN },
      { status: RoundStatus.SKIPPED },
    );
    if (result.affected === 0) {
      throw new ConflictException('이미 끝난 라운드입니다');
    }
    await this.recordQuietly(() => this.stats.recordSkipped(round.questionId), 'skipped');
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

  /**
   * 통계는 부가 기능이다. 실패해도 게임 흐름을 막지 않는다 —
   * 사람들이 하던 게임이 통계 때문에 멈추면 안 된다.
   */
  private async recordQuietly(action: () => Promise<void>, what: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.warn(`통계 기록 실패 (${what}): ${String(error)}`);
    }
  }

  private async recordRevealed(round: Round): Promise<void> {
    await this.recordQuietly(async () => {
      const answers = await this.listAnswers(round);
      // 답변이 2개 미만이면 분산도를 잴 수 없다. 0 으로 기록하면
      // "의견이 안 갈렸다" 로 읽혀 그 질문이 부당하게 은퇴 후보가 된다.
      if (answers.length < 2) return;
      await this.stats.recordAnswers(round.questionId, answers.map((a) => a.text));
    }, 'answers');
  }
}
