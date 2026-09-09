import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * votes 의 방 삭제 전파 누락을 바로잡는다.
 *
 * votes 는 answers 와 마찬가지로 라운드에 속하고 참가자가 작성하는 행이다.
 * 방을 지우면 이미 participants(fk_participants_room), rounds(fk_rounds_room),
 * answers(fk_answers_round, fk_answers_participant) 는 모두 CASCADE 로 함께
 * 지워진다. 그런데 votes 만 fk_votes_round / fk_votes_voter 가 NO ACTION 으로
 * 남아 있어서, 표가 하나라도 쌓인 방을 지우려 하면 그 시점에 FK 위반으로
 * 삭제 전체가 실패한다. 지금은 방을 지우는 기능이 없어 드러나지 않을 뿐이다.
 *
 * fk_votes_answer 는 소유 관계가 아니라 참조 관계다 — rounds.question_id,
 * rounds.revealed_by 와 같은 성격이므로 NO ACTION 을 그대로 둔다.
 */
export class FixVotesCascadeDelete1788939899290 implements MigrationInterface {
    name = 'FixVotesCascadeDelete1788939899290'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_round"`);
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_voter"`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_round" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_voter" FOREIGN KEY ("voter_participant_id") REFERENCES "participants"("id") ON DELETE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_voter"`);
        await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "fk_votes_round"`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_round" FOREIGN KEY ("round_id") REFERENCES "rounds"("id")`);
        await queryRunner.query(`ALTER TABLE "votes" ADD CONSTRAINT "fk_votes_voter" FOREIGN KEY ("voter_participant_id") REFERENCES "participants"("id")`);
    }
}
