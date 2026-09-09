import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { CurrentParticipant } from './auth/current-participant.decorator';
import { ParticipantGuard } from './auth/participant.guard';
import { CreateRoomDto, CreateRoomResponseDto } from './dto/create-room.dto';
import { JoinRoomDto, JoinRoomResponseDto } from './dto/join-room.dto';
import { ParticipantDto } from './dto/participant.dto';
import { RoomStateResponseDto } from './dto/room-state.dto';
import {
  RoundOpenResponseDto,
  RoundRevealedResponseDto,
  RoundSkippedResponseDto,
  SkipRoundResponseDto,
  StartRoundResponseDto,
} from './dto/round.dto';
import { SubmitAnswerDto, SubmitAnswerResponseDto } from './dto/submit-answer.dto';
import { CastVoteDto, CastVoteResponseDto } from './dto/vote.dto';
import { Participant } from './entities/participant.entity';
import { RoundStatus } from './enums/round-status.enum';
import { RoomService } from './room.service';
import { RoundService } from './round.service';
import { VoteService } from './vote.service';

@ApiTags('game')
@Controller()
export class GameController {
  constructor(
    private readonly rooms: RoomService,
    private readonly rounds: RoundService,
    private readonly votes: VoteService,
    @InjectRepository(Question) private readonly questions: Repository<Question>,
  ) {}

  @Post('rooms')
  @ApiOperation({
    summary: '방 만들기',
    description: `방을 만든 사람이 방장이자 첫 참가자가 된다. 인증 불필요.

응답의 \`participantToken\` 을 저장해 두고 이후 모든 요청의 \`X-Participant-Token\` 헤더에 넣는다.
계정이 없으므로 이 토큰이 곧 신분이다 — 잃어버리면 같은 참가자로 돌아올 수 없다.

\`\`\`jsonc
// 요청
{ "nickname": "지훈" }        // 1-20자

// 응답 201
{
  "code": "K3P9XM",           // 친구에게 공유할 방 코드. 링크는 프론트가 조립
  "participantToken": "8f3a...", // 이후 모든 요청 헤더에 사용
  "participantId": "1",
  "isHost": true              // 방을 만든 사람은 항상 true
}
\`\`\``,
  })
  @ApiCreatedResponse({ type: CreateRoomResponseDto })
  async createRoom(@Body() dto: CreateRoomDto): Promise<CreateRoomResponseDto> {
    const { room, participant } = await this.rooms.create(dto.nickname);
    return {
      code: room.code,
      participantToken: participant.token,
      participantId: participant.id,
      isHost: true,
    };
  }

  @Post('rooms/:code/participants')
  @ApiOperation({
    summary: '방에 참가',
    description: `방 코드로 참가한다. 인증 불필요 — 참가하면서 토큰을 발급받는다.

\`\`\`jsonc
// 요청
{ "nickname": "민수" }        // 1-20자. 같은 방 안에서 중복 불가

// 응답 201
{ "participantToken": "b71c...", "participantId": "2", "isHost": false }
\`\`\`

| 상태 | 뜻 |
|---|---|
| 404 | 그런 방 코드가 없음 |
| 409 | 같은 방에 같은 닉네임이 이미 있음 |`,
  })
  @ApiCreatedResponse({ type: JoinRoomResponseDto })
  async joinRoom(
    @Param('code') code: string,
    @Body() dto: JoinRoomDto,
  ): Promise<JoinRoomResponseDto> {
    const participant = await this.rooms.join(code, dto.nickname);
    return {
      participantToken: participant.token,
      participantId: participant.id,
      isHost: false,
    };
  }

  @Get('rooms/:code')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '방 상태 조회',
    description: `참가자 목록과 현재 라운드를 돌려준다. 대기 화면에서 2초 간격으로 폴링한다.

\`\`\`jsonc
// 응답 200
{
  "code": "K3P9XM",
  "status": "playing",           // waiting | playing
  "isHost": true,                // 요청자 기준
  "participants": [
    { "id": "1", "nickname": "지훈", "isHost": true },
    { "id": "2", "nickname": "민수", "isHost": false }
  ],
  "currentRound": {              // 라운드가 하나도 없으면 null
    "id": "10", "sequence": 3, "status": "open"
  }
}
\`\`\``,
  })
  @ApiOkResponse({ type: RoomStateResponseDto })
  async getRoom(
    @Param('code') code: string,
    @CurrentParticipant() me: Participant,
  ): Promise<RoomStateResponseDto> {
    const room = await this.rooms.findByCode(code);
    this.rooms.assertMember(room, me);

    const participants = await this.rooms.listParticipants(room.id);
    const latest = await this.rounds.findLatest(room.id);

    return {
      code: room.code,
      status: room.status,
      isHost: room.hostParticipantId === me.id,
      participants: participants.map((p) => this.toParticipantDto(p, room.hostParticipantId)),
      currentRound: latest
        ? { id: latest.id, sequence: latest.sequence, status: latest.status }
        : null,
    };
  }

  @Post('rooms/:code/rounds')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '다음 질문 시작 (방장)',
    description: `풀에서 질문 하나를 뽑아 새 라운드를 연다. 이 방에서 이미 나온 질문은 다시 나오지 않는다.

\`\`\`jsonc
// 요청 본문 없음
// 응답 201
{
  "roundId": "11",
  "sequence": 4,
  "question": { "id": "42", "text": "시각장애인은 변 닦고 다 닦였는지 어떻게 확인할까?" }
}
\`\`\`

| 상태 | 뜻 |
|---|---|
| 403 | 방장이 아님 |
| 409 | 이전 라운드가 아직 진행 중 |
| 409 | 이 방에서 낼 수 있는 질문이 더 이상 없음 |`,
  })
  @ApiCreatedResponse({ type: StartRoundResponseDto })
  async startRound(
    @Param('code') code: string,
    @CurrentParticipant() me: Participant,
  ): Promise<StartRoundResponseDto> {
    const room = await this.rooms.findByCode(code);
    this.rooms.assertMember(room, me);
    this.rooms.assertHost(room, me);

    const { round, question } = await this.rounds.start(room);
    return {
      roundId: round.id,
      sequence: round.sequence,
      question: { id: question.id, text: question.text },
    };
  }

  @Get('rounds/:id')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '라운드 상태 조회',
    description: `**응답 모양이 라운드 상태에 따라 다르다.** 공개 전에는 남의 답변이 응답에 실리지 않는다.

\`\`\`jsonc
// status = open — 답변 텍스트 필드가 아예 없다
{
  "roundId": "11",
  "status": "open",
  "question": { "id": "42", "text": "..." },
  "participants": [
    { "id": "1", "nickname": "지훈", "submitted": true },
    { "id": "2", "nickname": "민수", "submitted": false }
  ],
  "mySubmission": { "text": "촉감으로 확인할 것 같아" }   // 내 것만. 미제출이면 null
}
\`\`\`

\`\`\`jsonc
// status = revealed
{
  "roundId": "11",
  "status": "revealed",
  "question": { "id": "42", "text": "..." },
  "revealedAt": "2026-09-08T12:34:56.000Z",
  "revealedBy": { "id": "1", "nickname": "지훈", "isHost": true },  // 자동 공개면 null
  "answers": [
    { "participantId": "1", "nickname": "지훈", "text": "촉감으로..." },
    { "participantId": "2", "nickname": "민수", "text": "물티슈 색을..." }
  ],
  "notSubmitted": []          // 강제 공개 시 끝내 안 낸 사람들
}
\`\`\`

\`\`\`jsonc
// status = skipped — 스킵은 공개가 아니다. 이미 제출된 답변이 있어도
// 이 응답 모양엔 그걸 실을 필드 자체가 없다. answers/revealedAt 전부 없음
{
  "roundId": "11",
  "status": "skipped",
  "question": { "id": "42", "text": "..." }
}
\`\`\`

라운드가 열려 있는 동안 2초 간격으로 폴링한다. \`status\` 가 \`open\` 이 아니게 되면 폴링을 멈춘다.
\`revealed\` 면 공개 화면으로 전환해서 \`answers\` 를 보여주고, \`skipped\` 면 이번 질문은 건너뛰었다는
안내만 보여준다 — **스킵은 공개가 아니므로 응답에 답변 텍스트가 절대 없다.**`,
  })
  @ApiExtraModels(RoundOpenResponseDto, RoundRevealedResponseDto, RoundSkippedResponseDto)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(RoundOpenResponseDto) },
        { $ref: getSchemaPath(RoundRevealedResponseDto) },
        { $ref: getSchemaPath(RoundSkippedResponseDto) },
      ],
    },
  })
  async getRound(
    @Param('id') id: string,
    @CurrentParticipant() me: Participant,
  ): Promise<RoundOpenResponseDto | RoundRevealedResponseDto | RoundSkippedResponseDto> {
    const round = await this.rounds.findById(id);
    const room = await this.roomOf(round.roomId);
    this.rooms.assertMember(room, me);

    const question = await this.questions.findOne({ where: { id: round.questionId } });
    const questionDto = { id: round.questionId, text: question?.text ?? '' };

    if (round.status === RoundStatus.OPEN) {
      // 공개 전에는 listAnswers 를 절대 부르지 않는다 — 남의 답변 텍스트를
      // 프로세스 안으로도 끌어오지 않기 위함이다. 필요한 정보는 제출
      // 여부(submittedParticipantIds)와 내 답변(findMyAnswer)뿐이다.
      const participants = await this.rooms.listParticipants(round.roomId);
      const [submitted, mine, lengths] = await Promise.all([
        this.rounds.submittedParticipantIds(round.id),
        this.rounds.findMyAnswer(round.id, me.id),
        this.rounds.answerLengths(round.id),
      ]);
      return {
        roundId: round.id,
        status: 'open',
        question: questionDto,
        participants: participants.map((p) => ({
          id: p.id,
          nickname: p.nickname,
          submitted: submitted.has(p.id),
          answerLength: lengths.get(p.id) ?? null,
        })),
        mySubmission: mine ? { text: mine.text } : null,
      };
    }

    if (round.status === RoundStatus.SKIPPED) {
      // 스킵은 공개가 아니다. listAnswers 를 부르지 않는 것은 물론, 이
      // 응답 DTO 자체에 답변을 실을 필드가 없다 — 조건부로 비우는 게 아니라
      // 타입으로 유출 경로를 없앤다.
      return {
        roundId: round.id,
        status: 'skipped',
        question: questionDto,
      };
    }

    // round.status === RoundStatus.REVEALED. listAnswers 는 REVEALED 가
    // 아니면 스스로 거부하므로(화이트리스트), 여기서만 답변을 가져온다.
    const participants = await this.rooms.listParticipants(round.roomId);
    const answers = await this.rounds.listAnswers(round);
    const byId = new Map(participants.map((p) => [p.id, p]));
    const answeredIds = new Set(answers.map((a) => a.participantId));
    const [myVote, votedCount, voteCounts] = await Promise.all([
      this.votes.myVote(round.id, me.id),
      this.votes.votedCount(round.id),
      this.votes.countByAnswer(round.id),
    ]);
    const votingClosed = round.votingClosedAt !== null;

    return {
      roundId: round.id,
      status: 'revealed',
      question: questionDto,
      revealedAt: round.revealedAt ? round.revealedAt.toISOString() : null,
      revealedBy: round.revealedBy
        ? this.toParticipantDto(byId.get(round.revealedBy)!, room.hostParticipantId)
        : null,
      answers: answers.map((a) => ({
        participantId: a.participantId,
        nickname: byId.get(a.participantId)?.nickname ?? '(알 수 없음)',
        text: a.text,
        answerId: a.id,
        // 투표 중에는 집계를 내보내지 않는다. 보이면 앞서는 답에 표가 쏠린다.
        voteCount: votingClosed ? (voteCounts.get(a.id) ?? 0) : null,
      })),
      notSubmitted: participants
        .filter((p) => !answeredIds.has(p.id))
        .map((p) => this.toParticipantDto(p, room.hostParticipantId)),
      myVote: myVote ? { answerId: myVote.answerId } : null,
      votedCount,
      votingClosedAt: round.votingClosedAt ? round.votingClosedAt.toISOString() : null,
    };
  }

  @Post('rounds/:id/answers')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '답변 제출',
    description: `제출 후 수정할 수 없다. 마지막 한 명이 제출하면 그 요청으로 라운드가 즉시 공개된다.

\`\`\`jsonc
// 요청
{ "text": "촉감으로 확인할 것 같아" }    // 1-500자

// 응답 201
{
  "submitted": true,
  "allSubmitted": false        // true 면 이 제출로 라운드가 공개됐다
}
\`\`\`

| 상태 | 뜻 |
|---|---|
| 409 | 이미 제출함 (수정 불가) |
| 409 | 라운드가 이미 끝남 |`,
  })
  @ApiCreatedResponse({ type: SubmitAnswerResponseDto })
  async submitAnswer(
    @Param('id') id: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentParticipant() me: Participant,
  ): Promise<SubmitAnswerResponseDto> {
    const round = await this.rounds.findById(id);
    const result = await this.rounds.submit(round, me, dto.text);
    return { submitted: result.submitted, allSubmitted: result.allSubmitted };
  }

  @Post('rounds/:id/reveal')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '강제 공개 (방장)',
    description: `아직 안 낸 사람이 있어도 공개한다. 응답은 \`GET /rounds/:id\` 의 공개 후 응답과 같은 모양이고, 안 낸 사람은 \`notSubmitted\` 에 들어간다.

\`\`\`jsonc
// 요청 본문 없음
// 응답 200 — GET /rounds/:id 의 revealed 응답과 동일
\`\`\`

| 상태 | 뜻 |
|---|---|
| 403 | 방장이 아님 |
| 409 | 이미 끝난 라운드 (이미 공개됐거나 스킵됨) |`,
  })
  @ApiOkResponse({ type: RoundRevealedResponseDto })
  @HttpCode(HttpStatus.OK)
  async revealRound(
    @Param('id') id: string,
    @CurrentParticipant() me: Participant,
  ): Promise<RoundRevealedResponseDto> {
    const round = await this.rounds.findById(id);
    const room = await this.roomOf(round.roomId);
    this.rooms.assertMember(room, me);
    this.rooms.assertHost(room, me);

    await this.rounds.reveal(round, me.id);
    return (await this.getRound(id, me)) as RoundRevealedResponseDto;
  }

  @Post('rounds/:id/skip')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '질문 스킵 (방장)',
    description: `분위기에 안 맞거나 답이 안 나오는 질문을 넘긴다. 이 질문은 이 방에서 다시 나오지 않는다.

\`\`\`jsonc
// 요청 본문 없음
// 응답 200
{ "roundId": "11", "status": "skipped" }
\`\`\`

| 상태 | 뜻 |
|---|---|
| 403 | 방장이 아님 |
| 409 | 이미 끝난 라운드 (이미 공개됐거나 스킵됨) |`,
  })
  @ApiOkResponse({ type: SkipRoundResponseDto })
  @HttpCode(HttpStatus.OK)
  async skipRound(
    @Param('id') id: string,
    @CurrentParticipant() me: Participant,
  ): Promise<SkipRoundResponseDto> {
    const round = await this.rounds.findById(id);
    const room = await this.roomOf(round.roomId);
    this.rooms.assertMember(room, me);
    this.rooms.assertHost(room, me);

    const skipped = await this.rounds.skip(round);
    return { roundId: skipped.id, status: 'skipped' };
  }

  @Post('rounds/:id/votes')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @ApiOperation({
    summary: '투표',
    description: `공개된 답변 중 하나에 투표한다. **1인 1표이고 수정할 수 없다.** 자기 답변에도 투표할 수 있다.

\`\`\`jsonc
// 요청
{ "answerId": "77" }

// 응답 201
{
  "voted": true,
  "allVoted": false      // true 면 이 표로 투표가 끝나 득표 수가 공개됐다
}
\`\`\`

투표 중에는 \`GET /rounds/:id\` 의 \`answers[].voteCount\` 가 모두 \`null\` 이다. 투표가 끝나야 실제 수가 들어온다.

| 상태 | 이유 |
| --- | --- |
| 403 | 이 방 참가자가 아님 |
| 404 | 이 라운드에 없는 answerId |
| 409 | 아직 공개되지 않음 / 이미 투표함 / 투표가 이미 끝남 |`,
  })
  @ApiCreatedResponse({ type: CastVoteResponseDto })
  async castVote(
    @Param('id') id: string,
    @Body() dto: CastVoteDto,
    @CurrentParticipant() me: Participant,
  ): Promise<CastVoteResponseDto> {
    const round = await this.rounds.findById(id);
    const result = await this.votes.cast(round, me, dto.answerId);
    return { voted: result.voted, allVoted: result.allVoted };
  }

  @Post('rounds/:id/votes/close')
  @UseGuards(ParticipantGuard)
  @ApiSecurity('participantToken')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '투표 강제 종료',
    description: `아직 투표하지 않은 사람이 있어도 투표를 닫고 득표 수를 공개한다. **방장만 호출할 수 있다.**

응답은 갱신된 라운드 상태이며, \`votingClosedAt\` 이 채워지고 \`answers[].voteCount\` 에 실제 수가 들어온다.

| 상태 | 이유 |
| --- | --- |
| 403 | 방장이 아님 |
| 409 | 아직 공개되지 않음 / 투표가 이미 끝남 |`,
  })
  @ApiOkResponse({ type: RoundRevealedResponseDto })
  async closeVoting(
    @Param('id') id: string,
    @CurrentParticipant() me: Participant,
  ): Promise<RoundRevealedResponseDto> {
    const round = await this.rounds.findById(id);
    const room = await this.roomOf(round.roomId);
    this.rooms.assertMember(room, me);
    this.rooms.assertHost(room, me);
    await this.votes.close(round);
    return (await this.getRound(id, me)) as RoundRevealedResponseDto;
  }

  private async roomOf(roomId: string) {
    return this.rooms.findById(roomId);
  }

  private toParticipantDto(p: Participant, hostId: string | null): ParticipantDto {
    return { id: p.id, nickname: p.nickname, isHost: p.id === hostId };
  }
}
