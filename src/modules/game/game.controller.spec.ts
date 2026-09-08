import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { ParticipantGuard } from './auth/participant.guard';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { RoundStatus } from './enums/round-status.enum';
import { GameController } from './game.controller';
import { QuestionPoolService } from './question-pool.service';
import { RoomService } from './room.service';
import { RoundService } from './round.service';

describe('GameController', () => {
  let controller: GameController;
  const rooms = {
    create: jest.fn(),
    join: jest.fn(),
    findByCode: jest.fn(),
    findById: jest.fn(),
    listParticipants: jest.fn(),
    assertHost: jest.fn(),
    assertMember: jest.fn(),
  };
  const rounds = {
    start: jest.fn(),
    findById: jest.fn(),
    submit: jest.fn(),
    reveal: jest.fn(),
    skip: jest.fn(),
    listAnswers: jest.fn(),
    findMyAnswer: jest.fn(),
    submittedParticipantIds: jest.fn(),
  };
  const questions = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [GameController],
      providers: [
        { provide: RoomService, useValue: rooms },
        { provide: RoundService, useValue: rounds },
        { provide: QuestionPoolService, useValue: {} },
        { provide: getRepositoryToken(Question), useValue: questions },
      ],
    })
      // 컨트롤러 메서드를 직접 호출하므로 가드 파이프라인은 타지 않지만,
      // @UseGuards(ParticipantGuard) 가 모듈 스캔 시 이 가드를 injectable 로
      // 등록해 DI 컨테이너가 생성자 의존성(ParticipantRepository)을 요구한다.
      // 실제 인증 로직은 participant.guard.spec.ts 에서 별도로 검증한다.
      .overrideGuard(ParticipantGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();
    controller = moduleRef.get(GameController);
  });

  it('공개 전 응답에는 남의 답변이 어디에도 없다', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' },
      { id: '2', nickname: '민수' },
    ]);
    rounds.submittedParticipantIds.mockResolvedValue(new Set(['1', '2']));
    rounds.findMyAnswer.mockResolvedValue({ participantId: '1', text: '내 답변' });
    // 공개 전 브랜치는 listAnswers 를 아예 호출하지 않는다. 만약 회귀로
    // 다시 호출하게 되면 이 스텁이 남의 답변을 흘려서 아래 assertion 이 잡아낸다.
    rounds.listAnswers.mockResolvedValue([
      { participantId: '1', text: '내 답변' },
      { participantId: '2', text: '남의 비밀 답변' },
    ]);
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });

    const result = await controller.getRound('11', { id: '1', roomId: '1' } as Participant);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('남의 비밀 답변');
    expect(serialized).toContain('내 답변'); // 본인 것은 보인다
    expect(rounds.listAnswers).not.toHaveBeenCalled();
  });

  it('공개 후에는 모든 답변이 나온다', async () => {
    const round = {
      id: '11', roomId: '1', questionId: '42',
      status: RoundStatus.REVEALED, revealedAt: new Date(), revealedBy: null,
    } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' },
      { id: '2', nickname: '민수' },
    ]);
    rounds.listAnswers.mockResolvedValue([
      { participantId: '1', text: '내 답변' },
      { participantId: '2', text: '남의 답변' },
    ]);
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });

    const result = await controller.getRound('11', { id: '1', roomId: '1' } as Participant);

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('남의 답변');
    expect(rounds.listAnswers).toHaveBeenCalledWith(round);
  });
});
