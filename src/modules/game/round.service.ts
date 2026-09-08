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

  /**
   * 마지막으로 던진 fire-and-forget 통계 쓰기의 promise. 게임 흐름은 이걸
   * 기다리지 않는다 — 테스트가 완료를 확인하고 싶을 때만 접근한다.
   */
  private lastStatsWrite: Promise<void> = Promise.resolve();

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

    let round: Round;
    try {
      round = await this.rounds.save({
        roomId: room.id,
        questionId: question.id,
        sequence,
        status: RoundStatus.OPEN,
      } as Round);
    } catch (error) {
      // "열린 라운드는 방마다 하나" 유니크 인덱스가 막는다 — 위 findOne 체크와
      // insert 사이에 같은 방에서 동시에 두 번째 start() 가 끼어든 경우다.
      // 방장이 "다음 질문"을 두 번 눌러도 방이 영구적으로 막히지 않아야 한다.
      if ((error as { driverError?: { code?: string } }).driverError?.code === POSTGRES_UNIQUE_VIOLATION) {
        throw new ConflictException('이전 라운드가 아직 진행 중입니다');
      }
      throw error;
    }

    // 방 상태를 playing 으로 올린다. 이미 playing 이면 조건부 UPDATE 라 그대로 둔다.
    await this.rooms.markPlaying(room.id);

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

      // 전원 제출 시 자동 공개. 별도 스케줄러 없이 여기서 전이한다. 참가자
      // 수는 개수만 있으면 되므로 같은 트랜잭션의 manager 로 센다 —
      // rooms.listParticipants (기본 레포) 로 커넥션을 하나 더 꺼내면, 풀이
      // 전부 submit 트랜잭션에 잡혔을 때 아무도 두 번째 커넥션을 못 얻어
      // 전원이 멈춘다. 락 안에서 같은 커넥션으로 읽어 정합성도 보장한다.
      const [participantCount, submitted] = await Promise.all([
        manager.count(Participant, { where: { roomId: locked.roomId } }),
        manager.count(Answer, { where: { roundId: locked.id } }),
      ]);

      const allSubmitted = submitted >= participantCount;
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
    // 통계 기록 동안 계속 잡고 있게 된다. await 하지 않는다 — OpenAI 임베딩
    // 호출은 재시도까지 포함하면 수 초~수 분이 걸릴 수 있는데, 그동안 마지막
    // 제출자의 응답만 붙잡아두면 다른 사람들은 폴링으로 이미 공개를 보고
    // 있는 와중에 정작 그 사람 화면만 멈춘다. recordQuietly 가 예외는 이미
    // 삼키므로 지연도 격리한다. 테스트는 lastStatsWrite 로 완료를 기다린다.
    if (result.allSubmitted) {
      this.lastStatsWrite = this.recordRevealed(round.id);
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
    // submit() 과 같은 이유로 기다리지 않는다 — 강제 공개를 누른 방장이
    // OpenAI 호출이 끝날 때까지 멈춰 있을 이유가 없다.
    this.lastStatsWrite = this.recordRevealed(revealed.id);
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

  /**
   * REVEALED 상태의 라운드에서만 답변을 반환한다. 그 외는(open 은 물론
   * skipped 도) 전부 거부한다 — 화이트리스트다. "OPEN 이면 거부"였던 예전
   * 판정은 블랙리스트라 skipped 가 뚫렸다: 방장이 라운드를 스킵하면
   * revealedAt 이 null 인데도 이미 제출된 답변 전문이 그대로 나갔다. 다음에
   * 라운드 상태가 하나 더 생겨도 여기선 기본이 거부이므로 같은 사고가
   * 반복되지 않는다.
   */
  async listAnswers(round: Round): Promise<Answer[]> {
    if (round.status !== RoundStatus.REVEALED) {
      throw new ConflictException('공개된 라운드가 아닙니다');
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

  private async recordRevealed(roundId: string): Promise<void> {
    await this.recordQuietly(async () => {
      const round = await this.findById(roundId);
      const answers = await this.listAnswers(round);
      // 답변이 2개 미만이면 분산도를 잴 수 없다. 0 으로 기록하면
      // "의견이 안 갈렸다" 로 읽혀 그 질문이 부당하게 은퇴 후보가 된다.
      if (answers.length < 2) return;
      await this.stats.recordAnswers(round.questionId, answers.map((a) => a.text));
    }, 'answers');
  }
}
