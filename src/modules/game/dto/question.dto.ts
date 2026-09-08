import { ApiProperty } from '@nestjs/swagger';

export class QuestionDto {
  @ApiProperty({ description: '질문 id', example: '42' })
  id!: string;

  @ApiProperty({
    description: '질문 본문',
    example: '시각장애인은 변 닦고 다 닦였는지 어떻게 확인할까?',
  })
  text!: string;
}
