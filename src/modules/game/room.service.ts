import { randomInt } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { generateParticipantToken } from './auth/token';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';

export const ROOM_CODE_LENGTH = 6;
// 사람이 불러주고 받아적는 코드다. 0/O, 1/I 처럼 헷갈리는 글자를 뺀다.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_MAX_ATTEMPTS = 10;

export interface CreatedRoom {
  room: Room;
  participant: Participant;
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room) private readonly rooms: Repository<Room>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    private readonly dataSource: DataSource,
  ) {}

  async create(nickname: string): Promise<CreatedRoom> {
    const code = await this.allocateCode();

    return this.dataSource.transaction(async (manager) => {
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
  }

  async join(code: string, nickname: string): Promise<Participant> {
    const room = await this.findByCode(code);

    const existing = await this.participants.findOne({
      where: { roomId: room.id, nickname },
    });
    if (existing) {
      throw new ConflictException(`이미 "${nickname}" 이라는 참가자가 있습니다`);
    }

    return this.participants.save({
      roomId: room.id,
      nickname,
      token: generateParticipantToken(),
    } as Participant);
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

  private async allocateCode(): Promise<string> {
    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const taken = await this.rooms.findOne({ where: { code } });
      if (!taken) return code;
    }
    throw new ConflictException('방 코드를 발급하지 못했습니다. 다시 시도해 주세요');
  }
}
