import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Participant } from '../entities/participant.entity';

export const PARTICIPANT_TOKEN_HEADER = 'x-participant-token';

@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      participant?: Participant;
    }>();

    const token = request.headers[PARTICIPANT_TOKEN_HEADER];
    if (!token) {
      throw new UnauthorizedException('X-Participant-Token 헤더가 필요합니다');
    }

    const participant = await this.participants.findOne({ where: { token } });
    if (!participant) {
      throw new UnauthorizedException('유효하지 않은 참가자 토큰입니다');
    }

    request.participant = participant;
    return true;
  }
}
