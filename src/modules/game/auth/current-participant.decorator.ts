import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Participant } from '../entities/participant.entity';

export const CurrentParticipant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Participant => {
    return context.switchToHttp().getRequest<{ participant: Participant }>()
      .participant;
  },
);
