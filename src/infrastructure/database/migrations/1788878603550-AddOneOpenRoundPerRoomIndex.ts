import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 한 방에 open 상태 라운드는 동시에 하나뿐임을 DB 가 강제한다.
 *
 * 지금까지는 RoundService.start() 가 "open 라운드 있는지 확인 -> 질문
 * 뽑기 -> insert" 를 락 없이 했다. 방장이 "다음 질문" 버튼을 두 번 누르는
 * 것처럼 두 요청이 겹치면 같은 방에 open 라운드가 2개 생겼고, findLatest
 * 는 sequence 가 큰 것만 돌려주므로 seq 가 낮은 라운드는 영원히 open 으로
 * 남아 그 뒤 모든 start() 가 409 로 막혔다 — API 로는 복구가 불가능했다.
 *
 * 부분 유니크 인덱스로 이 경쟁을 DB 수준에서 막는다. round.service.ts 의
 * start() 는 이 인덱스 위반(23505)을 잡아 409 로 변환한다.
 */
export class AddOneOpenRoundPerRoomIndex1788878603550 implements MigrationInterface {
    name = 'AddOneOpenRoundPerRoomIndex1788878603550'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_rounds_one_open_per_room" ON "rounds" ("room_id") WHERE "status" = 'open'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."uq_rounds_one_open_per_room"`);
    }

}
