import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Question } from 'src/modules/questions/entities/question.entity';
import { QuestionStatus } from 'src/modules/questions/enums/question-status.enum';

export const AUTO_APPROVE_MIN_AVERAGE = 4.5;
export const AUTO_APPROVE_THRESHOLD = 0.7;
export const AUTO_APPROVE_MIN_APPROVED = 100;

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async listPending(limit = 20): Promise<Question[]> {
    return this.questions.find({
      where: { status: QuestionStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async countApproved(): Promise<number> {
    return this.questions.count({
      where: { status: In([QuestionStatus.APPROVED, QuestionStatus.LIVE]) },
    });
  }

  /**
   * 자동 승인 판정. 누적 승인이 100개를 넘기 전에는 항상 false.
   * 0.7~0.85 구간은 중복은 아니지만 사람 눈이 필요하므로 자동 승인하지 않는다.
   */
  shouldAutoApprove(
    question: Question,
    approvedCount: number,
    maxSimilarity: number,
  ): boolean {
    if (approvedCount < AUTO_APPROVE_MIN_APPROVED) return false;
    if (question.safetyPassed !== true) return false;
    if (question.judgeScores === null) return false;
    if (maxSimilarity >= AUTO_APPROVE_THRESHOLD) return false;

    const { variance, accessibility, concreteness, curiosity } = question.judgeScores;
    const average = (variance + accessibility + concreteness + curiosity) / 4;
    return average >= AUTO_APPROVE_MIN_AVERAGE;
  }

  async approve(id: string, reviewer: string): Promise<void> {
    await this.questions.update(id, {
      status: QuestionStatus.APPROVED,
      reviewedBy: reviewer,
      reviewedAt: new Date(),
    });
  }

  async reject(id: string, reviewer: string, reason: string): Promise<void> {
    await this.questions.update(id, {
      status: QuestionStatus.REJECTED,
      safetyReason: reason,
      reviewedBy: reviewer,
      reviewedAt: new Date(),
    });
  }

  /** 승인된 질문을 서빙 대상으로 올린다. 형식/소재 균형은 호출자가 정한다. */
  async publish(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.questions.update(ids, { status: QuestionStatus.LIVE });
  }
}
