import { randomInt } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { generateParticipantToken } from './auth/token';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { RoomStatus } from './enums/room-status.enum';

export const ROOM_CODE_LENGTH = 6;
// 사람이 불러주고 받아적는 코드다. 0/O, 1/I 처럼 헷갈리는 글자를 뺀다.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_MAX_ATTEMPTS = 10;
const POSTGRES_UNIQUE_VIOLATION = '23505';

export interface CreatedRoom {
  room: Room;
  participant: Participant;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    (error as { driverError?: { code?: string } } | null)?.driverError?.code ===
    POSTGRES_UNIQUE_VIOLATION
  );
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room) private readonly rooms: Repository<Room>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    private readonly dataSource: DataSource,
  ) {}

  async create(nickname: string): Promise<CreatedRoom> {
    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = await this.allocateCode();

      try {
        return await this.dataSource.transaction(async (manager) => {
          // 순서가 중요하다. rooms.host_participant_id 는 participants 를,
          // participants.room_id 는 rooms 를 참조하는 순환 구조라서
          // 방을 host 없이 먼저 만들고 -> 참가자 -> 방 갱신 순으로만 성립한다.
          const room = await manager.save(Room, { code } as Room);

          const participant = await manager.save(Participant, {
            roomId: room.id,
            nickname,
            token: generateParticipantToken(),
          } as Participant);

          await manager.update(Room, room.id, { hostParticipantId: participant.id });
          room.hostParticipantId = participant.id;

          return { room, participant };
        });
      } catch (error) {
        // allocateCode 의 사전 조회와 이 insert 사이에 다른 요청이 같은
        // 코드를 먼저 차지할 수 있다 — 그 경쟁을 여기서 새 코드로 재시도해
        // 흡수한다. 이 catch 가 없으면 그 순간의 요청만 500 을 받는다.
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new ServiceUnavailableException('방 코드를 발급하지 못했습니다. 다시 시도해 주세요');
  }

  async join(code: string, nickname: string): Promise<Participant> {
    const room = await this.findByCode(code);

    const existing = await this.participants.findOne({
      where: { roomId: room.id, nickname },
    });
    if (existing) {
      throw new ConflictException(`이미 "${nickname}" 이라는 참가자가 있습니다`);
    }

    try {
      return await this.participants.save({
        roomId: room.id,
        nickname,
        token: generateParticipantToken(),
      } as Participant);
    } catch (error) {
      // 위 조회와 insert 사이에 링크를 받은 두 친구가 동시에 같은 닉네임으로
      // 들어오면 (room_id, nickname) 유니크 제약이 막는다 — 그 경쟁을 409 로
      // 변환한다. 그대로 두면 500 이 나간다.
      if (isUniqueViolation(error)) {
        throw new ConflictException(`이미 "${nickname}" 이라는 참가자가 있습니다`);
      }
      throw error;
    }
  }

  async findByCode(code: string): Promise<Room> {
    const room = await this.rooms.findOne({ where: { code } });
    if (!room) throw new NotFoundException(`방을 찾을 수 없습니다: ${code}`);
    return room;
  }

  async findById(roomId: string): Promise<Room> {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`방을 찾을 수 없습니다: ${roomId}`);
    return room;
  }

  async listParticipants(roomId: string): Promise<Participant[]> {
    return this.participants.find({ where: { roomId }, order: { joinedAt: 'ASC' } });
  }

  assertHost(room: Room, participant: Participant): void {
    if (room.hostParticipantId !== participant.id) {
      throw new ForbiddenException('방장만 할 수 있습니다');
    }
  }

  assertMember(room: Room, participant: Participant): void {
    if (participant.roomId !== room.id) {
      throw new ForbiddenException('이 방의 참가자가 아닙니다');
    }
  }

  /** 방을 waiting 에서 playing 으로 조건부로 올린다. 이미 playing 이면 그대로 둔다. */
  async markPlaying(roomId: string): Promise<void> {
    await this.rooms.update(
      { id: roomId, status: RoomStatus.WAITING },
      { status: RoomStatus.PLAYING },
    );
  }

  private async allocateCode(): Promise<string> {
    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const taken = await this.rooms.findOne({ where: { code } });
      if (!taken) return code;
    }
    // 충돌이 아니라 자원 고갈이다 — 후보 공간이 소진된 상황이라 409 보다 503 이 맞다.
    throw new ServiceUnavailableException('방 코드를 발급하지 못했습니다. 다시 시도해 주세요');
  }
}
