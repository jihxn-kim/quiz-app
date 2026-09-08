import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('상태와 시각을 돌려준다', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(Date.parse(result.time)).not.toBeNaN();
  });
});
