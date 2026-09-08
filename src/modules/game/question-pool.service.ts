import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';

@Injectable()
export class QuestionPoolService {
  constructor(
    @InjectRepository(Question) private readonly questions: Repository<Question>,
  ) {}

  /**
   * 이 방에서 아직 나오지 않은 live 질문 하나를 무작위로 뽑는다.
   * 풀이 수백~수천 규모라 random() 정렬로 충분하다.
   */
  async drawForRoom(roomId: string): Promise<Question> {
    const question = await this.questions
      .createQueryBuilder('q')
      .where('q.status = :status', { status: QuestionStatus.LIVE })
      .andWhere(
        'q.id NOT IN (SELECT r.question_id FROM rounds r WHERE r.room_id = :roomId)',
        { roomId },
      )
      .orderBy('random()')
      .limit(1)
      .getOne();

    if (!question) {
      throw new ConflictException('이 방에서 낼 수 있는 질문이 더 이상 없습니다');
    }
    return question;
  }
}
