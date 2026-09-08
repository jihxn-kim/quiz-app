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

  /**
   * safetyPassed 가 null(미판정)인 질문을 맨 앞으로 정렬한다 — 사람이 반드시
   * 판단해야 하는 질문이 목록 뒤에 묻혀 대충 넘어가지 않도록 한다.
   * 나머지는 createdAt ASC 로 정렬한다.
   */
  async listPending(limit = 20): Promise<Question[]> {
    return this.questions.find({
      where: { status: QuestionStatus.PENDING },
      order: {
        safetyPassed: { direction: 'ASC', nulls: 'FIRST' },
        createdAt: 'ASC',
      },
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

  /**
   * 검수 대기(pending) 상태인 질문만 승인 대상으로 삼는다. 이미 처리됐거나
   * 존재하지 않는 id 로 호출하면 아무 행도 바뀌지 않으므로, 그런 경우
   * 성공한 것처럼 보이지 않도록 에러를 던진다.
   */
  async approve(id: string, reviewer: string): Promise<void> {
    const result = await this.questions.update(
      { id, status: QuestionStatus.PENDING },
      {
        status: QuestionStatus.APPROVED,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
      },
    );
    if (!result.affected) {
      throw new Error(`질문 ${id} 은(는) 검수 대기 상태가 아닙니다 (존재하지 않거나 이미 처리됨)`);
    }
  }

  /** approve 와 동일한 이유로 pending 상태에만 반려를 적용한다. */
  async reject(id: string, reviewer: string, reason: string): Promise<void> {
    const result = await this.questions.update(
      { id, status: QuestionStatus.PENDING },
      {
        status: QuestionStatus.REJECTED,
        safetyReason: reason,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
      },
    );
    if (!result.affected) {
      throw new Error(`질문 ${id} 은(는) 검수 대기 상태가 아닙니다 (존재하지 않거나 이미 처리됨)`);
    }
  }

  /**
   * approve 와 동일한 이유로 approved 상태에만 배포를 적용한다. 대상 id 중
   * 일부라도 approved 상태가 아니면(존재하지 않거나 이미 처리됨) 나머지만
   * 조용히 live 로 올리지 않고 에러를 던진다.
   */
  async publish(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const result = await this.questions.update(
      { id: In(ids), status: QuestionStatus.APPROVED },
      { status: QuestionStatus.LIVE },
    );
    if (result.affected !== ids.length) {
      const notApproved = ids.length - (result.affected ?? 0);
      throw new Error(
        `요청한 ${ids.length}건 중 ${notApproved}건이 승인(approved) 상태가 아닙니다 (존재하지 않거나 이미 처리됨)`,
      );
    }
  }
}
