import { ApiProperty } from '@nestjs/swagger';
import { ParticipantDto } from './participant.dto';

export class CurrentRoundDto {
  @ApiProperty({ description: '라운드 id', example: '10' })
  id!: string;

  @ApiProperty({ description: '방 안에서 몇 번째 라운드인지', example: 3 })
  sequence!: number;

  @ApiProperty({ description: '라운드 상태', example: 'open', enum: ['open', 'revealed', 'skipped'] })
  status!: string;

  @ApiProperty({
    description:
      '투표가 끝난 시각 (ISO 8601). 투표가 진행 중이거나 투표 단계에 이르지 않은 라운드면 null. ' +
      'status 가 revealed 인 동안에도 투표는 계속 진행되므로, 이 값이 null 이면 ' +
      '라운드 상세(GET /rounds/:id)를 계속 폴링해야 한다',
    example: '2026-09-09T12:35:10.000Z',
    nullable: true,
  })
  votingClosedAt!: string | null;
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
