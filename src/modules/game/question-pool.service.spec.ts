import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionPoolService } from './question-pool.service';

describe('QuestionPoolService', () => {
  let service: QuestionPoolService;
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const repo = { createQueryBuilder: jest.fn(() => qb) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionPoolService,
        { provide: getRepositoryToken(Question), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(QuestionPoolService);
  });

  it('낼 질문이 없으면 409', async () => {
    qb.getOne.mockResolvedValue(null);
    await expect(service.drawForRoom('1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('live 상태만 대상으로 한다', async () => {
    qb.getOne.mockResolvedValue({ id: '42' });
    await service.drawForRoom('1');
    expect(qb.where).toHaveBeenCalledWith('q.status = :status', { status: 'live' });
  });

  it('이 방에서 이미 나온 질문을 제외한다', async () => {
    qb.getOne.mockResolvedValue({ id: '42' });
    await service.drawForRoom('7');
    const [clause, params] = qb.andWhere.mock.calls[0];
    // 'rounds' 만 확인하면 room_id 조건이 빠져도 통과한다 — 모든 방에서 나온 질문을
    // 통째로 제외하게 되는 회귀를 잡으려면 조건절 전문을 확인해야 한다.
    expect(String(clause)).toBe(
      'q.id NOT IN (SELECT r.question_id FROM rounds r WHERE r.room_id = :roomId)',
    );
    expect(params).toEqual({ roomId: '7' });
  });

  it('무작위 정렬한다', async () => {
    qb.getOne.mockResolvedValue({ id: '42' });
    await service.drawForRoom('1');
    expect(qb.orderBy).toHaveBeenCalledWith('random()');
  });
});
