import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ description: '서버 상태', example: 'ok' })
  status!: string;

  @ApiProperty({ description: '응답 생성 시각 (ISO 8601)', example: '2026-09-08T12:34:56.000Z' })
  time!: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: '서버 생존 확인',
    description: `배포 헬스체크용. 인증 불필요.

\`\`\`jsonc
// 응답 200
{
  "status": "ok",                          // 항상 "ok". 실패하면 응답 자체가 없다
  "time": "2026-09-08T12:34:56.000Z"       // 서버 기준 현재 시각
}
\`\`\``,
  })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
