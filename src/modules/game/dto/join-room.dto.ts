import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class JoinRoomDto {
  @ApiProperty({ description: '내가 쓸 닉네임. 같은 방에 중복 불가', example: '민수', minLength: 1, maxLength: 20 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 20)
  nickname!: string;
}

export class JoinRoomResponseDto {
  @ApiProperty({ description: '이후 모든 요청에 쓸 토큰', example: 'b71c9e...' })
  participantToken!: string;

  @ApiProperty({ description: '내 참가자 id', example: '2' })
  participantId!: string;

  @ApiProperty({ description: '방장 여부. 참가로 들어온 사람은 항상 false', example: false })
  isHost!: boolean;
}
