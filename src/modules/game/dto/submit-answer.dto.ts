import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class SubmitAnswerDto {
  @ApiProperty({ description: '내 답변. 제출 후 수정 불가', example: '촉감으로 확인할 것 같아', minLength: 1, maxLength: 500 })
  @IsString()
  @Length(1, 500)
  text!: string;
}

export class SubmitAnswerResponseDto {
  @ApiProperty({ description: '항상 true. 실패하면 에러 응답이 온다', example: true })
  submitted!: boolean;

  @ApiProperty({
    description: '이 제출로 전원이 다 냈는지. true 면 이 요청으로 라운드가 공개됐다는 뜻이다',
    example: false,
  })
  allSubmitted!: boolean;
}
