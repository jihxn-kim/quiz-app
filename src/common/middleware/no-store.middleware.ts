import { Injectable, NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'http';

// 프론트는 웹소켓 없이 GET /rooms/:code, GET /rounds/:id 를 2초 간격으로
// 폴링해 "누가 냈는지 / 공개됐는지" 를 읽는다 — 매 응답이 그 순간의 진실이어야
// 하는 API 다. Express 는 기본으로 Cache-Control 을 아예 안 보내는데, 그러면
// 브라우저 HTTP 캐시가 자체 판단으로 응답을 저장해 버릴 수 있다. 백엔드가
// 죽어도 캐시된 200 이 재생되면 플레이어 화면은 "2명이 냈어요" 에 멈춰서도
// 아무 에러 없이 조용히 멈춘다 — 폴링 버그와 증상이 같은 종류의 사고다.
//
// 라우트마다 헤더를 다는 대신 여기서 모든 요청에 한 번에 건다 — 나중에 추가되는
// 엔드포인트도 기억해서 챙기지 않아도 기본값으로 안전하다. 컨트롤러/가드 이전
// 단계인 미들웨어라 인증 실패(401)·권한 실패(403)·404 응답에도 똑같이 걸린다.
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(_req: IncomingMessage, res: ServerResponse, next: () => void): void {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
}
