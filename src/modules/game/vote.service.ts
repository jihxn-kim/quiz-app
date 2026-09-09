import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Answer } from './entities/answer.entity';
import { Participant } from './entities/participant.entity';
import { Round } from './entities/round.entity';
import { Vote } from './entities/vote.entity';
import { RoundStatus } from './enums/round-status.enum';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export interface VoteResult {
  voted: true;
  allVoted: boolean;
}

@Injectable()
export class VoteService {
  constructor(
    @InjectRepository(Vote) private readonly votes: Repository<Vote>,
    @InjectRepository(Round) private readonly rounds: Repository<Round>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 표를 던진다. 답변 제출과 같은 구조다 — 라운드 행을 잠그고 트랜잭션
   * 안에서 상태 확인·중복 확인·insert·완료 판정을 한 번에 처리한다.
   * 잠금이 없으면 닫힌 뒤 들어온 표가 저장되거나 같은 사람의 두 표가 함께
   * 통과한다.
   */
  async cast(
    round: Round,
    participant: Participant,
    answerId: string,
  ): Promise<VoteResult> {
    if (participant.roomId !== round.roomId) {
      throw new ForbiddenException('이 방의 참가자가 아닙니다');
    }

    // 자기 답변에 투표하는 것을 막지 않는다 — 의도된 동작이다.
    // 검사를 "빠뜨린" 것이 아니므로 추가하지 말 것.

    return this.dataSource.transaction<VoteResult>(async (manager) => {
      const locked = await manager.findOne(Round, {
        where: { id: round.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`라운드를 찾을 수 없습니다: ${round.id}`);
      if (locked.status !== RoundStatus.REVEALED) {
        throw new ConflictException('아직 공개되지 않은 라운드입니다');
      }
      if (locked.votingClosedAt !== null) {
        throw new ConflictException('투표가 이미 끝났습니다');
      }

      // 다른 라운드의 답변에 투표하는 것을 막는다.
      const answer = await manager.findOne(Answer, {
        where: { id: answerId, roundId: locked.id },
      });
      if (!answer) {
        throw new NotFoundException('이 라운드에 없는 답변입니다');
      }

      const existing = await manager.findOne(Vote, {
        where: { roundId: locked.id, voterParticipantId: participant.id },
      });
      if (existing) {
        throw new ConflictException('이미 투표했습니다. 수정할 수 없습니다');
      }

      try {
        await manager.save(Vote, {
          roundId: locked.id,
          voterParticipantId: participant.id,
          answerId,
        } as Vote);
      } catch (error) {
        if (
          (error as { driverError?: { code?: string } }).driverError?.code ===
          POSTGRES_UNIQUE_VIOLATION
        ) {
          throw new ConflictException('이미 투표했습니다. 수정할 수 없습니다');
        }
        throw error;
      }

      // 참가자 수는 개수만 있으면 되므로 같은 트랜잭션의 manager 로 센다 —
      // rooms.listParticipants (기본 레포) 로 커넥션을 하나 더 꺼내면, 풀이
      // 전부 cast 트랜잭션에 잡혔을 때 아무도 두 번째 커넥션을 못 얻어
      // 전원이 멈춘다. 락 안에서 같은 커넥션으로 읽어 정합성도 보장한다.
      const [participantCount, voted] = await Promise.all([
        manager.count(Participant, { where: { roomId: locked.roomId } }),
        manager.count(Vote, { where: { roundId: locked.id } }),
      ]);

      const allVoted = voted >= participantCount;
      if (allVoted) {
        locked.votingClosedAt = new Date();
        await manager.save(Round, locked);
      }

      return { voted: true, allVoted };
    });
  }

  /**
   * 방장이 투표를 강제 종료한다. 조건부 UPDATE 라 이미 닫힌 라운드를
   * 다시 닫거나 시각을 덮어쓰지 않는다.
   */
  async close(round: Round): Promise<Round> {
    const result = await this.rounds.update(
      { id: round.id, votingClosedAt: IsNull() },
      { votingClosedAt: new Date() },
    );
    if (result.affected === 0) {
      throw new ConflictException('투표가 이미 끝났습니다');
    }
    const updated = await this.rounds.findOne({ where: { id: round.id } });
    if (!updated) throw new NotFoundException(`라운드를 찾을 수 없습니다: ${round.id}`);
    return updated;
  }

  /** 내가 던진 표. 안 던졌으면 null. */
  async myVote(roundId: string, participantId: string): Promise<Vote | null> {
    return this.votes.findOne({ where: { roundId, voterParticipantId: participantId } });
  }

  /**
   * 답변별 득표 수. 누가 던졌는지는 담지 않는다 — 결과 화면에는 수만 나간다.
   */
  async countByAnswer(roundId: string): Promise<Map<string, number>> {
    const rows = await this.votes.find({
      where: { roundId },
      select: { answerId: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.answerId, (counts.get(row.answerId) ?? 0) + 1);
    }
    return counts;
  }

  /** 몇 명이 투표했는지. */
  async votedCount(roundId: string): Promise<number> {
    return this.votes.count({ where: { roundId } });
  }
}
