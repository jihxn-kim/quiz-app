import { MigrationInterface, QueryRunner } from "typeorm";

export class InitQuestionPipeline1788847112960 implements MigrationInterface {
    name = 'InitQuestionPipeline1788847112960'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "seed_combinations" ("seed_hash" character varying(16) NOT NULL, "format" character varying(32) NOT NULL, "axis_values" jsonb NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_69eb6c631a75ff972784fb521fb" PRIMARY KEY ("seed_hash"))`);
        await queryRunner.query(`CREATE TABLE "seed_axes" ("id" BIGSERIAL NOT NULL, "format" character varying(32) NOT NULL, "axis_name" character varying(64) NOT NULL, "value" text NOT NULL, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_24cd87acc4969fbc1989204b1f8" UNIQUE ("format", "axis_name", "value"), CONSTRAINT "PK_87c02875e807ffe4893948582b3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "questions" ("id" BIGSERIAL NOT NULL, "text" text NOT NULL, "format" character varying(32) NOT NULL, "topic_tags" text array NOT NULL DEFAULT '{}', "seed_hash" character varying(16), "embedding" real array, "judge_scores" jsonb, "safety_passed" boolean, "safety_reason" text, "status" character varying(16) NOT NULL DEFAULT 'pending', "golden" boolean NOT NULL DEFAULT false, "batch_id" character varying(64), "reviewed_by" character varying(64), "reviewed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_08a6d4b0f49ff300bf3a0ca60ac" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_af792955dd34a5a12081c886bf" ON "questions" ("status", "format") `);
        await queryRunner.query(`CREATE TABLE "question_stats" ("question_id" bigint NOT NULL, "served" integer NOT NULL DEFAULT '0', "completed" integer NOT NULL DEFAULT '0', "skipped" integer NOT NULL DEFAULT '0', "answer_variance" real, "avg_answer_len" real, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_962bd28cd6598cae1bc1a9d4139" PRIMARY KEY ("question_id"))`);
        await queryRunner.query(`CREATE TABLE "generation_batches" ("id" character varying(64) NOT NULL, "format" character varying(32) NOT NULL, "seed_count" integer NOT NULL, "generated" integer NOT NULL DEFAULT '0', "deduped" integer NOT NULL DEFAULT '0', "judge_passed" integer NOT NULL DEFAULT '0', "safety_passed" integer NOT NULL DEFAULT '0', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, "error" text, CONSTRAINT "PK_5e8ab91b4aabc776f3f5a9c55f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "questions" ADD CONSTRAINT "FK_72dc905d3c103a99dc41dad1eff" FOREIGN KEY ("seed_hash") REFERENCES "seed_combinations"("seed_hash") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "question_stats" ADD CONSTRAINT "FK_962bd28cd6598cae1bc1a9d4139" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "question_stats" DROP CONSTRAINT "FK_962bd28cd6598cae1bc1a9d4139"`);
        await queryRunner.query(`ALTER TABLE "questions" DROP CONSTRAINT "FK_72dc905d3c103a99dc41dad1eff"`);
        await queryRunner.query(`DROP TABLE "generation_batches"`);
        await queryRunner.query(`DROP TABLE "question_stats"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af792955dd34a5a12081c886bf"`);
        await queryRunner.query(`DROP TABLE "questions"`);
        await queryRunner.query(`DROP TABLE "seed_axes"`);
        await queryRunner.query(`DROP TABLE "seed_combinations"`);
    }

}
