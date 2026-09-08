import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { Question } from 'src/modules/questions/entities/question.entity';
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

    // logger 가 아니라 console 로 낸다. 타임스탬프·PID 프레이밍이 줄마다 60자씩
    // 붙으면 질문 텍스트가 밀려서 훑기 어려워지고, 검수자가 대충 승인하기 시작하면
    // 안전 설계가 기대는 사람 게이트가 형식만 남는다.
    const lines: string[] = [
      `검수 대기 ${pending.length}건 / 누적 승인 ${approved}건`,
      '점수: v=답변분산 a=접근성 c=구체성 q=궁금증 (각 0-5)',
      '',
    ];
    for (const question of pending) {
      const scores = question.judgeScores;
      const score = scores
        ? `v${scores.variance} a${scores.accessibility} c${scores.concreteness} q${scores.curiosity}`
        : '판정없음';
      lines.push(`[${question.id}] (${score}) ${question.text}`);
      if (scores?.reason) lines.push(`      근거: ${scores.reason}`);
      lines.push(`      ${this.formatSafetyLine(question)}`);
      lines.push('');
    }
    console.log(lines.join('\n'));
  }

  /**
   * safetyPassed 가 null 인 경우를 통과와 구분해서 반드시 보여준다.
   * 여기서 안전 판정을 숨기면, null(미판정)과 true(통과)가 화면에서
   * 똑같이 보여서 사람 검수 게이트가 형식만 남는다.
   */
  private formatSafetyLine(question: Question): string {
    if (question.safetyPassed === null) {
      return '안전: 미판정 — 안전 필터가 평가하지 못함 (반드시 사람이 판단)';
    }
    const verdict = question.safetyPassed ? '통과' : '탈락';
    return question.safetyReason
      ? `안전: ${verdict} (${question.safetyReason})`
      : `안전: ${verdict}`;
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
