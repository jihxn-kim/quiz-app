import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';
import { JoinRoomDto } from './join-room.dto';
import { SubmitAnswerDto } from './submit-answer.dto';

/**
 * main.ts 의 ValidationPipe({ transform: true }) 가 실제로 하는 작업과
 * 동일하게(plainToInstance -> validate) 검증한다. 트림 전에는 "   " 가
 * @Length(1, 20) 을 통과했고, 중복 검사가 바이트 일치라 "지훈" 과 "지훈 "
 * 이 서로 다른 참가자로 공존했다.
 */
describe('DTO 닉네임/답변 trim', () => {
  it('CreateRoomDto: 닉네임 앞뒤 공백을 제거한다', async () => {
    const dto = plainToInstance(CreateRoomDto, { nickname: '  지훈  ' });
    expect(dto.nickname).toBe('지훈');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('CreateRoomDto: 공백만 있는 닉네임은 트림 후 빈 문자열이라 거부된다', async () => {
    const dto = plainToInstance(CreateRoomDto, { nickname: '   ' });
    expect(dto.nickname).toBe('');
    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0].property).toBe('nickname');
  });

  it('JoinRoomDto: 닉네임 앞뒤 공백을 제거한다', async () => {
    const dto = plainToInstance(JoinRoomDto, { nickname: ' 민수' });
    expect(dto.nickname).toBe('민수');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('SubmitAnswerDto: 답변 앞뒤 공백을 제거한다', async () => {
    const dto = plainToInstance(SubmitAnswerDto, { text: '  촉감으로 확인할 것 같아  ' });
    expect(dto.text).toBe('촉감으로 확인할 것 같아');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('SubmitAnswerDto: 공백만 있는 답변은 트림 후 빈 문자열이라 거부된다', async () => {
    const dto = plainToInstance(SubmitAnswerDto, { text: '    ' });
    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0].property).toBe('text');
  });
});
