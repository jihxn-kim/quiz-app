import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGameTables1788870097755 implements MigrationInterface {
    name = 'AddGameTables1788870097755'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "rounds" ("id" BIGSERIAL NOT NULL, "room_id" bigint NOT NULL, "question_id" bigint NOT NULL, "sequence" integer NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'open', "revealed_at" TIMESTAMP WITH TIME ZONE, "revealed_by" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ce5707e5e30f323e618f5cd3ad0" UNIQUE ("room_id", "question_id"), CONSTRAINT "UQ_1934af7d4098a6aef160e36018a" UNIQUE ("room_id", "sequence"), CONSTRAINT "PK_9d254884a20817016e2f877c7e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8c84e0aafdd6efec2faf9822d3" ON "rounds" ("room_id", "status") `);
        await queryRunner.query(`CREATE TABLE "rooms" ("id" BIGSERIAL NOT NULL, "code" character varying(8) NOT NULL, "host_participant_id" bigint, "status" character varying(16) NOT NULL DEFAULT 'waiting', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_368d83b661b9670e7be1bbb9cdd" UNIQUE ("code"), CONSTRAINT "PK_0368a2d7c215f2d0458a54933f2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "participants" ("id" BIGSERIAL NOT NULL, "room_id" bigint NOT NULL, "nickname" character varying(20) NOT NULL, "token" character varying(64) NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4a97f386ddb7fa00ee22643e2c6" UNIQUE ("token"), CONSTRAINT "UQ_f7a22a090c7bc4a1de1a8eebac4" UNIQUE ("room_id", "nickname"), CONSTRAINT "PK_1cda06c31eec1c95b3365a0283f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "answers" ("id" BIGSERIAL NOT NULL, "round_id" bigint NOT NULL, "participant_id" bigint NOT NULL, "text" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3bb3a2634c6a790ac969566e702" UNIQUE ("round_id", "participant_id"), CONSTRAINT "PK_9c32cec6c71e06da0254f2226c6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_008552f101562053f4b3147e0e" ON "answers" ("round_id") `);
        await queryRunner.query(`ALTER TABLE "participants" ADD CONSTRAINT "fk_participants_room" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "rooms" ADD CONSTRAINT "fk_rooms_host" FOREIGN KEY ("host_participant_id") REFERENCES "participants"("id")`);
        await queryRunner.query(`ALTER TABLE "rounds" ADD CONSTRAINT "fk_rounds_room" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "rounds" ADD CONSTRAINT "fk_rounds_question" FOREIGN KEY ("question_id") REFERENCES "questions"("id")`);
        await queryRunner.query(`ALTER TABLE "rounds" ADD CONSTRAINT "fk_rounds_revealed_by" FOREIGN KEY ("revealed_by") REFERENCES "participants"("id")`);
        await queryRunner.query(`ALTER TABLE "answers" ADD CONSTRAINT "fk_answers_round" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "answers" ADD CONSTRAINT "fk_answers_participant" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "answers" DROP CONSTRAINT "fk_answers_participant"`);
        await queryRunner.query(`ALTER TABLE "answers" DROP CONSTRAINT "fk_answers_round"`);
        await queryRunner.query(`ALTER TABLE "rounds" DROP CONSTRAINT "fk_rounds_revealed_by"`);
        await queryRunner.query(`ALTER TABLE "rounds" DROP CONSTRAINT "fk_rounds_question"`);
        await queryRunner.query(`ALTER TABLE "rounds" DROP CONSTRAINT "fk_rounds_room"`);
        await queryRunner.query(`ALTER TABLE "rooms" DROP CONSTRAINT "fk_rooms_host"`);
        await queryRunner.query(`ALTER TABLE "participants" DROP CONSTRAINT "fk_participants_room"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_008552f101562053f4b3147e0e"`);
        await queryRunner.query(`DROP TABLE "answers"`);
        await queryRunner.query(`DROP TABLE "participants"`);
        await queryRunner.query(`DROP TABLE "rooms"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8c84e0aafdd6efec2faf9822d3"`);
        await queryRunner.query(`DROP TABLE "rounds"`);
    }

}
