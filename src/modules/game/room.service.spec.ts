import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { RoomStatus } from './enums/room-status.enum';
import { RoomService, ROOM_CODE_LENGTH } from './room.service';

const uniqueViolation = (): Error => {
  const error = new Error('duplicate key value violates unique constraint');
  (error as { driverError?: { code?: string } }).driverError = { code: '23505' };
  return error;
};

describe('RoomService', () => {
  let service: RoomService;
  const roomRepo = { findOne: jest.fn(), update: jest.fn() };
  const participantRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn() };
  const manager = { save: jest.fn(), update: jest.fn(), findOne: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.transaction.mockImplementation(async (cb: (m: unknown) => Promise<unknown>) =>
      cb(manager),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomService,
        { provide: getRepositoryToken(Room), useValue: roomRepo },
        { provide: getRepositoryToken(Participant), useValue: participantRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(RoomService);
  });

  describe('create', () => {
    it('방을 먼저 만들고 참가자를 만든 뒤 방장을 채운다 (순환 FK 순서)', async () => {
      const order: string[] = [];
      manager.save.mockImplementation(async (entity: unknown, value: unknown) => {
        order.push(entity === Room ? 'room' : 'participant');
        return { id: order.length === 1 ? '1' : '2', ...(value as object) };
      });
      manager.update.mockImplementation(async () => {
        order.push('update-host');
      });
      roomRepo.findOne.mockResolvedValue(null); // 코드 중복 없음

      await service.create('지훈');

      expect(order).toEqual(['room', 'participant', 'update-host']);
    });

    it('발급 코드가 정해진 길이다', async () => {
      manager.save.mockImplementation(async (_e: unknown, v: unknown) => ({ id: '1', ...(v as object) }));
      roomRepo.findOne.mockResolvedValue(null);

      const created = await service.create('지훈');

      expect(created.room.code).toHaveLength(ROOM_CODE_LENGTH);
    });

    it('I6: room insert 가 경쟁으로 유니크 위반이면 새 코드로 재시도해 성공한다', async () => {
      // allocateCode 의 사전 조회(findOne)와 실제 insert 사이에 다른 요청이
      // 같은 코드를 먼저 차지한 경쟁 상황. 그 순간엔 findOne 이 아직 못 보고
      // 통과시켰다가, insert 시점에 유니크 제약이 막는다.
      roomRepo.findOne.mockResolvedValue(null); // 사전 체크는 항상 통과
      let roomSaveCalls = 0;
      manager.save.mockImplementation(async (entity: unknown, value: unknown) => {
        if (entity === Room) {
          roomSaveCalls += 1;
          if (roomSaveCalls === 1) throw uniqueViolation();
          return { id: '1', ...(value as object) };
        }
        return { id: '2', ...(value as object) };
      });

      const created = await service.create('지훈');

      expect(roomSaveCalls).toBe(2);
      expect(created.participant).toBeDefined();
    });

    it('I6: room insert 가 계속 유니크 위반이면 409 가 아니라 503 (충돌이 아니라 자원 고갈)', async () => {
      roomRepo.findOne.mockResolvedValue(null);
      manager.save.mockImplementation(async (entity: unknown) => {
        if (entity === Room) throw uniqueViolation();
        return { id: '2' };
      });

      await expect(service.create('지훈')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('코드 후보가 계속 이미 사용 중이면 503 (충돌이 아니라 자원 고갈)', async () => {
      roomRepo.findOne.mockResolvedValue({ id: 'taken' }); // 모든 후보가 이미 사용 중
      await expect(service.create('지훈')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('join', () => {
    it('없는 코드면 404', async () => {
      roomRepo.findOne.mockResolvedValue(null);
      await expect(service.join('NOPE12', '민수')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('같은 방에 같은 닉네임이 있으면 409', async () => {
      roomRepo.findOne.mockResolvedValue({ id: '1' });
      participantRepo.findOne.mockResolvedValue({ id: '9', nickname: '민수' });
      await expect(service.join('K3P9XM', '민수')).rejects.toBeInstanceOf(ConflictException);
    });

    it('I6: 사전 조회 뒤 insert 가 유니크 위반으로 경쟁하면 409 로 변환한다', async () => {
      // 링크 받은 두 친구가 동시에 같은 닉네임으로 들어오면, 사전 조회
      // (findOne) 시점엔 둘 다 통과하고 insert 에서 (room_id, nickname)
      // 유니크 제약이 막는다. 이 경쟁을 그대로 두면 500 이 나간다.
      roomRepo.findOne.mockResolvedValue({ id: '1' });
      participantRepo.findOne.mockResolvedValue(null); // 사전 체크 시점엔 없었음
      participantRepo.save.mockImplementation(() => {
        throw uniqueViolation();
      });

      await expect(service.join('K3P9XM', '민수')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('markPlaying', () => {
    it('I1: waiting 인 방을 playing 으로 조건부 갱신한다', async () => {
      roomRepo.update.mockResolvedValue({ affected: 1 });

      await service.markPlaying('1');

      expect(roomRepo.update).toHaveBeenCalledWith(
        { id: '1', status: RoomStatus.WAITING },
        { status: RoomStatus.PLAYING },
      );
    });

    it('I1: 이미 playing 이면 조건부 UPDATE 라 아무 영향이 없어도 에러가 나지 않는다', async () => {
      roomRepo.update.mockResolvedValue({ affected: 0 });
      await expect(service.markPlaying('1')).resolves.toBeUndefined();
    });
  });

  describe('assertHost', () => {
    it('방장이면 통과', () => {
      expect(() =>
        service.assertHost({ hostParticipantId: '1' } as Room, { id: '1' } as Participant),
      ).not.toThrow();
    });

    it('방장이 아니면 403', () => {
      expect(() =>
        service.assertHost({ hostParticipantId: '1' } as Room, { id: '2' } as Participant),
      ).toThrow(ForbiddenException);
    });
  });

  describe('assertMember', () => {
    it('다른 방 참가자면 403', () => {
      expect(() =>
        service.assertMember({ id: '1' } as Room, { roomId: '2' } as Participant),
      ).toThrow(ForbiddenException);
    });
  });
});
