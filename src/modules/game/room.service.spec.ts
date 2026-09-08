import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { RoomService, ROOM_CODE_LENGTH } from './room.service';

describe('RoomService', () => {
  let service: RoomService;
  const roomRepo = { findOne: jest.fn() };
  const participantRepo = { find: jest.fn(), findOne: jest.fn() };
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
