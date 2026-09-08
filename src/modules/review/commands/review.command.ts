import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { ReviewService } from '../review.service';

interface ReviewOptions {
  approve?: string;
  reject?: string;
  reason?: string;
  reviewer: string;
}

@Command({ name: 'review', description: '검수 큐를 보거나 승인/반려한다' })
export class ReviewCommand extends CommandRunner {
  private readonly logger = new Logger(ReviewCommand.name);

  constructor(private readonly review: ReviewService) {
    super();
  }

  async run(_args: string[], options: ReviewOptions): Promise<void> {
    if (options.approve) {
      await this.review.approve(options.approve, options.reviewer);
      this.logger.log(`승인: ${options.approve}`);
      return;
    }
    if (options.reject) {
      await this.review.reject(
        options.reject,
        options.reviewer,
        options.reason ?? '사유 미기재',
      );
      this.logger.log(`반려: ${options.reject}`);
      return;
    }

    const pending = await this.review.listPending();
    const approved = await this.review.countApproved();
    this.logger.log(`검수 대기 ${pending.length}건 / 누적 승인 ${approved}건`);
    for (const question of pending) {
      const scores = question.judgeScores;
      const score = scores
        ? `v${scores.variance} a${scores.accessibility} c${scores.concreteness} q${scores.curiosity}`
        : '판정없음';
      this.logger.log(`[${question.id}] (${score}) ${question.text}`);
      if (scores?.reason) this.logger.log(`      근거: ${scores.reason}`);
      if (question.safetyReason) this.logger.log(`      안전: ${question.safetyReason}`);
    }
  }

  @Option({ flags: '--approve <id>', description: '승인할 질문 id' })
  parseApprove(value: string): string { return value; }

  @Option({ flags: '--reject <id>', description: '반려할 질문 id' })
  parseReject(value: string): string { return value; }

  @Option({ flags: '--reason <reason>', description: '반려 사유' })
  parseReason(value: string): string { return value; }

  @Option({
    flags: '--reviewer <name>',
    description: '검수자 이름',
    defaultValue: 'unknown',
  })
  parseReviewer(value: string): string { return value; }
}
