import { ApiProperty } from '@nestjs/swagger';
import { ParticipantDto, ParticipantSubmissionDto } from './participant.dto';
import { QuestionDto } from './question.dto';
import { MyVoteDto } from './vote.dto';

export class MySubmissionDto {
  @ApiProperty({ description: '내가 제출한 답변', example: '촉감으로 확인할 것 같아' })
  text!: string;
}

/**
 * 공개 전 응답. 남의 답변을 담을 필드가 존재하지 않는다.
 * 조건부로 비우는 대신 타입을 분리해 유출 경로 자체를 없앤다.
 */
export class RoundOpenResponseDto {
  @ApiProperty({ description: '라운드 id', example: '11' })
  roundId!: string;

  @ApiProperty({ description: '라운드 상태', example: 'open', enum: ['open'] })
  status!: 'open';

  @ApiProperty({ description: '이번 라운드 질문', type: QuestionDto })
  question!: QuestionDto;

  @ApiProperty({ description: '참가자별 제출 여부. 답변 내용은 포함되지 않는다', type: [ParticipantSubmissionDto] })
  participants!: ParticipantSubmissionDto[];

  @ApiProperty({
    description: '내가 제출한 답변. 아직 안 냈으면 null. 본인 것만 보인다',
    type: MySubmissionDto,
    nullable: true,
  })
  mySubmission!: MySubmissionDto | null;
}

export class RevealedAnswerDto {
  @ApiProperty({ description: '참가자 id', example: '2' })
  participantId!: string;

  @ApiProperty({ description: '닉네임', example: '민수' })
  nickname!: string;

  @ApiProperty({ description: '답변 본문', example: '물티슈 색을 손으로...' })
  text!: string;

  @ApiProperty({ description: '이 답변의 id. 투표할 때 이 값을 보낸다', example: '77' })
  answerId!: string;

  @ApiProperty({
    description:
      '득표 수. 투표가 끝나기 전에는 null 이다 — 실시간 집계가 보이면 ' +
      '앞서는 답에 표가 쏠린다',
    example: 2,
    nullable: true,
  })
  voteCount!: number | null;
}

/**
 * 공개 후 응답. 답변 텍스트가 나오는 곳은 이 타입 하나뿐이다. 스킵된
 * 라운드는 이 DTO 를 절대 쓰지 않는다 — RoundSkippedResponseDto 로 완전히
 * 분리했다. 조건부로 answers 를 비우는 방식이었다면, 다음에 라운드 상태가
 * 하나 더 생겼을 때 또 같은 유출이 반복될 수 있었다.
 */
export class RoundRevealedResponseDto {
  @ApiProperty({ description: '라운드 id', example: '11' })
  roundId!: string;

  @ApiProperty({ description: '라운드 상태', example: 'revealed', enum: ['revealed'] })
  status!: 'revealed';

  @ApiProperty({ description: '이번 라운드 질문', type: QuestionDto })
  question!: QuestionDto;

  @ApiProperty({ description: '공개 시각 (ISO 8601)', example: '2026-09-08T12:34:56.000Z', nullable: true })
  revealedAt!: string | null;

  @ApiProperty({
    description: '강제 공개한 방장. 전원 제출로 자동 공개됐으면 null',
    type: ParticipantDto,
    nullable: true,
  })
  revealedBy!: ParticipantDto | null;

  @ApiProperty({ description: '제출된 답변 전체', type: [RevealedAnswerDto] })
  answers!: RevealedAnswerDto[];

  @ApiProperty({ description: '끝내 제출하지 않은 참가자. 강제 공개 시에만 채워진다', type: [ParticipantDto] })
  notSubmitted!: ParticipantDto[];

  @ApiProperty({
    description: '내가 투표한 답변. 아직 안 했으면 null',
    type: MyVoteDto,
    nullable: true,
  })
  myVote!: MyVoteDto | null;

  @ApiProperty({ description: '투표를 마친 사람 수. 누가 했는지는 포함되지 않는다', example: 2 })
  votedCount!: number;

  @ApiProperty({
    description:
      '투표가 끝난 시각 (ISO 8601). 아직 진행 중이면 null. ' +
      '모든 클라이언트가 이 시각을 기준으로 결과 연출 타이밍을 계산한다',
    example: '2026-09-09T12:35:10.000Z',
    nullable: true,
  })
  votingClosedAt!: string | null;
}

export class StartRoundResponseDto {
  @ApiProperty({ description: '새로 시작된 라운드 id', example: '11' })
  roundId!: string;

  @ApiProperty({ description: '방 안에서 몇 번째 라운드인지', example: 4 })
  sequence!: number;

  @ApiProperty({ description: '뽑힌 질문', type: QuestionDto })
  question!: QuestionDto;
}

export class SkipRoundResponseDto {
  @ApiProperty({ description: '스킵된 라운드 id', example: '11' })
  roundId!: string;

  @ApiProperty({ description: '항상 skipped', example: 'skipped', enum: ['skipped'] })
  status!: 'skipped';
}

/**
 * 스킵된 라운드의 조회 응답(`GET /rounds/:id`). 스킵은 공개가 아니다 —
 * 제출된 답변이 있어도 이 응답 모양 자체에 그걸 담을 필드가 없다. 그래서
 * 스킵 전에 누가 답을 냈든, 아무것도 안 낸 사람에게도 answers 는 절대
 * 보이지 않는다.
 */
export class RoundSkippedResponseDto {
  @ApiProperty({ description: '라운드 id', example: '11' })
  roundId!: string;

  @ApiProperty({ description: '항상 skipped', example: 'skipped', enum: ['skipped'] })
  status!: 'skipped';

  @ApiProperty({ description: '스킵된 라운드의 질문', type: QuestionDto })
  question!: QuestionDto;
}
