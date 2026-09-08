import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // 'log' 를 빼서 InstanceLoader 부트스트랩 로그를 죽인다.
  // 검수 큐는 사람이 읽는 화면이라 프레임워크 소음이 내용을 밀어낸다.
  await CommandFactory.run(AppModule, ['warn', 'error']);
}

void bootstrap();
