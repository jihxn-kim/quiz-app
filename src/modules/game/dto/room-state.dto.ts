import { ApiProperty } from '@nestjs/swagger';
import { ParticipantDto } from './participant.dto';

export class CurrentRoundDto {
  @ApiProperty({ description: '라운드 id', example: '10' })
  id!: string;

  @ApiProperty({ description: '방 안에서 몇 번째 라운드인지', example: 3 })
  sequence!: number;

  @ApiProperty({ description: '라운드 상태', example: 'open', enum: ['open', 'revealed', 'skipped'] })
  status!: string;
}

export class RoomStateResponseDto {
  @ApiProperty({ description: '방 코드', example: 'K3P9XM' })
  code!: string;

  @ApiProperty({ description: '방 상태', example: 'playing', enum: ['waiting', 'playing'] })
  status!: string;

  @ApiProperty({ description: '요청자가 방장인지', example: true })
  isHost!: boolean;

  @ApiProperty({ description: '참가자 목록 (참가 순)', type: [ParticipantDto] })
  participants!: ParticipantDto[];

  @ApiProperty({
    description: '진행 중이거나 마지막으로 끝난 라운드. 라운드가 하나도 없으면 null',
    type: CurrentRoundDto,
    nullable: true,
  })
  currentRound!: CurrentRoundDto | null;
}
