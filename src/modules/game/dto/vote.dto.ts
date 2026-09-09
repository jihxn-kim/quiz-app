import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CastVoteDto {
  @ApiProperty({ description: '투표할 답변의 id', example: '77' })
  @IsString({ message: '답변 id 가 필요합니다' })
  answerId!: string;
}

export class CastVoteResponseDto {
  @ApiProperty({ description: '항상 true', example: true })
  voted!: boolean;

  @ApiProperty({
    description: 'true 면 이 표로 투표가 끝나 득표 수가 공개됐다',
    example: false,
  })
  allVoted!: boolean;
}

export class MyVoteDto {
  @ApiProperty({ description: '내가 투표한 답변의 id', example: '77' })
  answerId!: string;
}
