import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // 'log' 를 유지한다. NestJS 는 로그 레벨을 전역 정적으로 덮어쓰므로 이걸 빼면
  // seed/generate/stats 의 진행 로그까지 전부 죽어 명령이 벙어리가 된다.
  // 부트스트랩 소음은 세션당 한 번 스크롤하면 그만이고, 실제 문제였던
  // "줄마다 붙는 60자 프레이밍" 은 검수 목록을 console.log 로 낸 것으로 해결됐다.
  await CommandFactory.run(AppModule, ['warn', 'error', 'log']);
}

void bootstrap();
