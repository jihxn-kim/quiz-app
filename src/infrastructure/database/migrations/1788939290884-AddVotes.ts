import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 투표 테이블과 투표 종료 시각.
 *
 * UNIQUE(round_id, voter_participant_id) 가 1인 1표를 DB 수준에서 강제한다.
 * 애플리케이션 검사만으로는 동시 요청에서 두 표가 들어간다 — 답변 제출에서
 * 이미 같은 문제를 겪고 유니크 제약으로 막았다.
 *
 * voting_closed_at 은 결과 공개 연출의 기준점이다. 모든 클라이언트가 이
 * 시각을 기준으로 계산하므로 폴링 시점이 달라도 득표 수가 같은 순간에 열린다.
 */
export class AddVotes1788939290884 implements MigrationInterface {
    name = 'AddVotes1788939290884'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rounds" ADD "voting_closed_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE TABLE "votes" ("id" BIGSERIAL NOT NULL, "round_id" bigint NOT NULL, "voter_participant_id" bigint NOT NULL, "answer_id" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_votes" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_votes_round_voter" ON "votes" ("round_id", "voter_participant_id")`);
        await queryRunner.query(`CREATE INDEX "idx_votes_round" ON "votes" ("round_id")`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_round" FOREIGN KEY ("round_id") REFERENCES "rounds"("id")`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_voter" FOREIGN KEY ("voter_participant_id") REFERENCES "participants"("id")`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_answer" FOREIGN KEY ("answer_id") REFERENCES "answers"("id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_answer"`);
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_voter"`);
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_round"`);
        await queryRunner.query(`DROP INDEX "idx_votes_round"`);
        await queryRunner.query(`DROP INDEX "uq_votes_round_voter"`);
        await queryRunner.query(`DROP TABLE "votes"`);
        await queryRunner.query(`ALTER TABLE "rounds" DROP COLUMN "voting_closed_at"`);
    }
}
