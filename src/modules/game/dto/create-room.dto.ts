import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ description: '방장이 쓸 닉네임', example: '지훈', minLength: 1, maxLength: 20 })
  @IsString()
  @Length(1, 20)
  nickname!: string;
}

export class CreateRoomResponseDto {
  @ApiProperty({ description: '공유용 방 코드. 링크는 프론트가 조립한다', example: 'K3P9XM' })
  code!: string;

  @ApiProperty({
    description: '이후 모든 요청의 X-Participant-Token 헤더에 넣을 값. 클라이언트가 보관한다',
    example: '8f3a1c...',
  })
  participantToken!: string;

  @ApiProperty({ description: '내 참가자 id', example: '1' })
  participantId!: string;

  @ApiProperty({ description: '방장 여부. 방을 만든 사람은 항상 true', example: true })
  isHost!: boolean;
}
