import { ApiProperty } from '@nestjs/swagger';
import { ParticipantDto, ParticipantSubmissionDto } from './participant.dto';
import { QuestionDto } from './question.dto';

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
}

/** 공개 후 응답. 이 타입에서만 답변 텍스트가 나온다. */
export class RoundRevealedResponseDto {
  @ApiProperty({ description: '라운드 id', example: '11' })
  roundId!: string;

  @ApiProperty({ description: '라운드 상태', example: 'revealed', enum: ['revealed', 'skipped'] })
  status!: 'revealed' | 'skipped';

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
