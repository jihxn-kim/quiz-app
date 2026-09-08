import { z } from 'zod';
import { toStrictJsonSchema } from './json-schema';

describe('toStrictJsonSchema', () => {
  it('모든 객체 노드에 additionalProperties: false 를 넣는다', () => {
    const schema = z.object({ items: z.array(z.object({ text: z.string() })) });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.additionalProperties).toBe(false);
    expect(json.properties.items.items.additionalProperties).toBe(false);
  });

  it('모든 객체 노드의 required 에 전체 프로퍼티 키를 채운다', () => {
    const schema = z.object({
      a: z.string(),
      b: z.number(),
      nested: z.object({ c: z.string(), d: z.boolean() }),
    });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.required.sort()).toEqual(['a', 'b', 'nested']);
    expect(json.properties.nested.required.sort()).toEqual(['c', 'd']);
  });

  it('optional 필드도 required 에 넣는다 (strict 모드 요구사항)', () => {
    const schema = z.object({ a: z.string(), b: z.string().optional() });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.required.sort()).toEqual(['a', 'b']);
  });

  it('최상위 타입이 object 다', () => {
    const schema = z.object({ items: z.array(z.string()) });
    expect((toStrictJsonSchema(schema) as any).type).toBe('object');
  });

  it('enum 을 보존한다', () => {
    const schema = z.object({ tag: z.enum(['a', 'b']) });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.properties.tag.enum.sort()).toEqual(['a', 'b']);
  });

  it('배열 안의 원시 타입은 건드리지 않는다', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const json = toStrictJsonSchema(schema) as any;

    expect(json.properties.tags.items.type).toBe('string');
    expect(json.properties.tags.items.additionalProperties).toBeUndefined();
  });
});
