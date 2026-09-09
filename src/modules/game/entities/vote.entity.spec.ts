import { getMetadataArgsStorage } from 'typeorm';
import { Vote } from './vote.entity';

/**
 * Vote 는 getter/setter/검증이 없는 순수 데이터 클래스라 필드 대입/조회를
 * 확인하는 테스트는 항상 통과한다 — TypeORM 데코레이터가 있든 없든, 컬럼명이
 * 맞든 틀리든. 실제로 엔티티 파일이 통제하는 것은 TypeORM 메타데이터뿐이므로
 * getMetadataArgsStorage() 로 직접 그 메타데이터를 검사한다.
 */
describe('Vote 엔티티 메타데이터', () => {
  const columns = getMetadataArgsStorage().filterColumns(Vote);
  const uniques = getMetadataArgsStorage().uniques.filter(
    (u) => u.target === Vote,
  );

  const columnByProperty = (propertyName: string) =>
    columns.find((c) => c.propertyName === propertyName);

  it('각 필드를 지정된 컬럼명에 매핑한다', () => {
    expect(columnByProperty('roundId')?.options.name).toBe('round_id');
    expect(columnByProperty('voterParticipantId')?.options.name).toBe(
      'voter_participant_id',
    );
    expect(columnByProperty('answerId')?.options.name).toBe('answer_id');
    expect(columnByProperty('createdAt')?.options.name).toBe('created_at');
  });

  it('(round_id, voter_participant_id) 조합에 유니크 제약을 건다', () => {
    expect(uniques).toHaveLength(1);
    expect(uniques[0].columns).toEqual(['roundId', 'voterParticipantId']);
  });
});
