import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { ParticipantGuard } from './auth/participant.guard';
import { RoundOpenResponseDto, RoundRevealedResponseDto } from './dto/round.dto';
import { Participant } from './entities/participant.entity';
import { Room } from './entities/room.entity';
import { Round } from './entities/round.entity';
import { RoundStatus } from './enums/round-status.enum';
import { GameController } from './game.controller';
import { RoomService } from './room.service';
import { RoundService } from './round.service';
import { VoteService } from './vote.service';

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
    findLatest: jest.fn(),
    submit: jest.fn(),
    reveal: jest.fn(),
    skip: jest.fn(),
    listAnswers: jest.fn(),
    findMyAnswer: jest.fn(),
    submittedParticipantIds: jest.fn(),
    answerLengths: jest.fn(),
  };
  const votes = {
    cast: jest.fn(),
    close: jest.fn(),
    myVote: jest.fn(),
    countByAnswer: jest.fn(),
    votedCount: jest.fn(),
  };
  const questions = { findOne: jest.fn() };

  beforeEach(async () => {
    // resetAllMocks 를 쓴다 — clearAllMocks 는 호출 기록만 지우고
    // mockImplementation 은 그대로 남겨서, 어떤 테스트가 assertMember/
    // assertHost 를 던지게 설정하면 그 뒤에 도는 테스트까지 오염된다.
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [GameController],
      providers: [
        { provide: RoomService, useValue: rooms },
        { provide: RoundService, useValue: rounds },
        { provide: VoteService, useValue: votes },
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
    rounds.answerLengths.mockResolvedValue(new Map([['1', 3], ['2', 6]]));
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
      votingClosedAt: null,
    } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' },
      { id: '2', nickname: '민수' },
    ]);
    rounds.listAnswers.mockResolvedValue([
      { id: '77', participantId: '1', text: '내 답변' },
      { id: '88', participantId: '2', text: '남의 답변' },
    ]);
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });
    votes.myVote.mockResolvedValue(null);
    votes.votedCount.mockResolvedValue(0);
    votes.countByAnswer.mockResolvedValue(new Map());

    const result = await controller.getRound('11', { id: '1', roomId: '1' } as Participant);

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('남의 답변');
    expect(rounds.listAnswers).toHaveBeenCalledWith(round);
  });

  it('C1: 스킵된 라운드는 listAnswers 를 부르지 않고, 응답에 답변 텍스트가 없다', async () => {
    // 실 DB 재현: 2명 중 1명이 제출한 상태에서 방장이 스킵하면, 아무것도
    // 안 낸 사람에게도 제출된 답변 전문이 그대로 보였다. revealedAt 이
    // null 인데도. 스킵 분기는 listAnswers 를 아예 부르지 않고, 응답
    // DTO(RoundSkippedResponseDto) 자체에 답변을 실을 필드가 없다.
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.SKIPPED } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    // 만약 회귀로 listAnswers 가 다시 불리면 이 스텁이 남의 답변을 흘려서
    // 아래 assertion 이 잡아낸다.
    rounds.listAnswers.mockResolvedValue([
      { participantId: '1', text: '지훈의 민감한 답변' },
      { participantId: '2', text: '민수의 민감한 답변' },
    ]);
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });

    // 이 라운드에 아무것도 제출하지 않은 참가자(id: '3')가 조회한다.
    const result = await controller.getRound('11', { id: '3', roomId: '1' } as Participant);

    expect(result).toEqual({
      roundId: '11',
      status: 'skipped',
      question: { id: '42', text: '질문?' },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('민감한 답변');
    expect(rounds.listAnswers).not.toHaveBeenCalled();
    expect(rooms.listParticipants).not.toHaveBeenCalled();
  });

  it('getRound: 다른 방 참가자면 거부되고 답변을 조회하지 않는다', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.REVEALED } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.assertMember.mockImplementation(() => {
      throw new ForbiddenException('이 방의 참가자가 아닙니다');
    });

    await expect(
      controller.getRound('11', { id: '99', roomId: '2' } as Participant),
    ).rejects.toThrow(ForbiddenException);

    // 거부가 데이터 조회보다 먼저 일어나야 한다 — 남의 답변이 프로세스
    // 안으로도 들어오면 안 되므로 listAnswers 뿐 아니라 그 앞의 조회들도
    // 아예 호출되지 않았는지 확인한다.
    expect(rounds.listAnswers).not.toHaveBeenCalled();
    expect(rooms.listParticipants).not.toHaveBeenCalled();
    expect(questions.findOne).not.toHaveBeenCalled();
  });

  it('getRound: 열린 라운드에서 아직 제출하지 않았으면 mySubmission 은 null 이다', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' },
      { id: '2', nickname: '민수' },
    ]);
    rounds.submittedParticipantIds.mockResolvedValue(new Set(['1']));
    rounds.findMyAnswer.mockResolvedValue(null);
    rounds.answerLengths.mockResolvedValue(new Map());
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });

    const result = await controller.getRound('11', { id: '2', roomId: '1' } as Participant);

    expect((result as { mySubmission: unknown }).mySubmission).toBeNull();
  });

  it('투표 전에는 득표 수를 보내지 않는다', async () => {
    const round = {
      id: '11', roomId: '1', questionId: '42', status: RoundStatus.REVEALED,
      revealedAt: new Date(), revealedBy: null, votingClosedAt: null,
    } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' }, { id: '2', nickname: '민수' },
    ]);
    rounds.listAnswers.mockResolvedValue([
      { id: '77', participantId: '1', text: '내 답' },
      { id: '88', participantId: '2', text: '남의 답' },
    ]);
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });
    votes.myVote.mockResolvedValue(null);
    votes.votedCount.mockResolvedValue(1);
    votes.countByAnswer.mockResolvedValue(new Map([['77', 1]]));

    const result = await controller.getRound('11', { id: '1', roomId: '1' } as Participant);

    const revealed = result as RoundRevealedResponseDto;
    expect(revealed.answers.every((a) => a.voteCount === null)).toBe(true);
    expect(revealed.votedCount).toBe(1);
    expect(revealed.votingClosedAt).toBeNull();
  });

  it('투표가 끝나면 득표 수가 실린다', async () => {
    const closedAt = new Date();
    const round = {
      id: '11', roomId: '1', questionId: '42', status: RoundStatus.REVEALED,
      revealedAt: new Date(), revealedBy: null, votingClosedAt: closedAt,
    } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' }, { id: '2', nickname: '민수' },
    ]);
    rounds.listAnswers.mockResolvedValue([
      { id: '77', participantId: '1', text: '내 답' },
      { id: '88', participantId: '2', text: '남의 답' },
    ]);
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });
    votes.myVote.mockResolvedValue({ answerId: '88' });
    votes.votedCount.mockResolvedValue(2);
    votes.countByAnswer.mockResolvedValue(new Map([['88', 2]]));

    const revealed = (await controller.getRound(
      '11', { id: '1', roomId: '1' } as Participant,
    )) as RoundRevealedResponseDto;

    expect(revealed.answers.find((a) => a.answerId === '88')?.voteCount).toBe(2);
    expect(revealed.answers.find((a) => a.answerId === '77')?.voteCount).toBe(0);
    expect(revealed.myVote).toEqual({ answerId: '88' });
    expect(revealed.votingClosedAt).toBe(closedAt.toISOString());
  });

  it('공개 전 응답에 답변 길이는 있고 텍스트는 없다', async () => {
    const round = {
      id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN,
    } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.listParticipants.mockResolvedValue([
      { id: '1', nickname: '지훈' }, { id: '2', nickname: '민수' },
    ]);
    rounds.submittedParticipantIds.mockResolvedValue(new Set(['2']));
    rounds.findMyAnswer.mockResolvedValue(null);
    rounds.answerLengths.mockResolvedValue(new Map([['2', 9]]));
    questions.findOne.mockResolvedValue({ id: '42', text: '질문?' });

    const result = await controller.getRound('11', { id: '1', roomId: '1' } as Participant);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('남의 답');
    const open = result as RoundOpenResponseDto;
    expect(open.participants.find((p) => p.id === '2')?.answerLength).toBe(9);
    expect(open.participants.find((p) => p.id === '1')?.answerLength).toBeNull();
  });

  it('startRound: 방장이 아니면 거부되고 라운드를 시작하지 않는다', async () => {
    rooms.findByCode.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.assertHost.mockImplementation(() => {
      throw new ForbiddenException('방장만 할 수 있습니다');
    });

    await expect(
      controller.startRound('K3P9XM', { id: '2', roomId: '1' } as Participant),
    ).rejects.toThrow(ForbiddenException);

    expect(rounds.start).not.toHaveBeenCalled();
  });

  it('revealRound: 방장이 아니면 거부되고 공개하지 않는다', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.assertHost.mockImplementation(() => {
      throw new ForbiddenException('방장만 할 수 있습니다');
    });

    await expect(
      controller.revealRound('11', { id: '2', roomId: '1' } as Participant),
    ).rejects.toThrow(ForbiddenException);

    expect(rounds.reveal).not.toHaveBeenCalled();
  });

  it('skipRound: 방장이 아니면 거부되고 스킵하지 않는다', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.assertHost.mockImplementation(() => {
      throw new ForbiddenException('방장만 할 수 있습니다');
    });

    await expect(
      controller.skipRound('11', { id: '2', roomId: '1' } as Participant),
    ).rejects.toThrow(ForbiddenException);

    expect(rounds.skip).not.toHaveBeenCalled();
  });

  it('closeVoting: 방장이 아니면 거부되고 투표를 닫지 않는다', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.REVEALED } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.assertHost.mockImplementation(() => {
      throw new ForbiddenException('방장만 할 수 있습니다');
    });

    await expect(
      controller.closeVoting('11', { id: '2', roomId: '1' } as Participant),
    ).rejects.toThrow(ForbiddenException);

    expect(votes.close).not.toHaveBeenCalled();
  });

  it('closeVoting: 공개되지 않은 라운드면 거부된다', async () => {
    // VoteService.close 가 REVEALED 가 아니면 던지는 걸 그대로 흘려보내야
    // 한다. 예전엔 여기서 검사가 없어 open/skipped 라운드에서도 강제 종료가
    // 통과했고, votingClosedAt 만 찍혀 이후 투표가 영영 막혔다.
    const round = {
      id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN, votingClosedAt: null,
    } as Round;
    rounds.findById.mockResolvedValue(round);
    rooms.findById.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    votes.close.mockRejectedValue(new ConflictException('아직 공개되지 않은 라운드입니다'));

    await expect(
      controller.closeVoting('11', { id: '1', roomId: '1' } as Participant),
    ).rejects.toThrow(ConflictException);
  });

  it('castVote: 정상 경로 응답 모양', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.REVEALED } as Round;
    rounds.findById.mockResolvedValue(round);
    votes.cast.mockResolvedValue({ voted: true, allVoted: false });

    const result = await controller.castVote(
      '11',
      { answerId: '77' },
      { id: '1', roomId: '1' } as Participant,
    );

    expect(result).toEqual({ voted: true, allVoted: false });
    expect(votes.cast).toHaveBeenCalledWith(round, { id: '1', roomId: '1' }, '77');
  });

  it('castVote: 다른 방 참가자면 거부된다 (VoteService.cast 가 직접 검사한다)', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.REVEALED } as Round;
    rounds.findById.mockResolvedValue(round);
    votes.cast.mockRejectedValue(new ForbiddenException('이 방의 참가자가 아닙니다'));

    await expect(
      controller.castVote('11', { answerId: '77' }, { id: '99', roomId: '2' } as Participant),
    ).rejects.toThrow(ForbiddenException);
  });

  it('getRoom: 다른 방 참가자면 거부되고 방 정보를 조회하지 않는다', async () => {
    rooms.findByCode.mockResolvedValue({ id: '1', hostParticipantId: '1' } as Room);
    rooms.assertMember.mockImplementation(() => {
      throw new ForbiddenException('이 방의 참가자가 아닙니다');
    });

    await expect(
      controller.getRoom('K3P9XM', { id: '99', roomId: '2' } as Participant),
    ).rejects.toThrow(ForbiddenException);

    expect(rooms.listParticipants).not.toHaveBeenCalled();
    expect(rounds.findLatest).not.toHaveBeenCalled();
  });

  it('createRoom: 정상 경로 응답 모양', async () => {
    rooms.create.mockResolvedValue({
      room: { id: '1', code: 'K3P9XM' } as Room,
      participant: { id: '1', token: '8f3a1c...' } as Participant,
    });

    const result = await controller.createRoom({ nickname: '지훈' });

    expect(result).toEqual({
      code: 'K3P9XM',
      participantToken: '8f3a1c...',
      participantId: '1',
      isHost: true,
    });
  });

  it('joinRoom: 정상 경로 응답 모양', async () => {
    rooms.join.mockResolvedValue({ id: '2', token: 'b71c9e...' } as Participant);

    const result = await controller.joinRoom('K3P9XM', { nickname: '민수' });

    expect(result).toEqual({
      participantToken: 'b71c9e...',
      participantId: '2',
      isHost: false,
    });
  });

  it('submitAnswer: 정상 경로 응답 모양', async () => {
    const round = { id: '11', roomId: '1', questionId: '42', status: RoundStatus.OPEN } as Round;
    rounds.findById.mockResolvedValue(round);
    rounds.submit.mockResolvedValue({ submitted: true, allSubmitted: false });

    const result = await controller.submitAnswer(
      '11',
      { text: '촉감으로 확인할 것 같아' },
      { id: '1', roomId: '1' } as Participant,
    );

    expect(result).toEqual({ submitted: true, allSubmitted: false });
  });
});
