import { ApiProperty } from '@nestjs/swagger';

export class ParticipantDto {
  @ApiProperty({ description: '참가자 id', example: '1' })
  id!: string;

  @ApiProperty({ description: '닉네임', example: '지훈' })
  nickname!: string;

  @ApiProperty({ description: '이 참가자가 방장인지', example: true })
  isHost!: boolean;
}

export class ParticipantSubmissionDto {
  @ApiProperty({ description: '참가자 id', example: '2' })
  id!: string;

  @ApiProperty({ description: '닉네임', example: '민수' })
  nickname!: string;

  @ApiProperty({ description: '이 라운드에 답변을 제출했는지', example: false })
  submitted!: boolean;

  @ApiProperty({
    description:
      '제출한 답변의 글자 수. 미제출이면 null. 공개 전 블러 블록을 그리는 용도이며 ' +
      '답변 내용은 어떤 경우에도 포함되지 않는다',
    example: 23,
    nullable: true,
  })
  answerLength!: number | null;
}
