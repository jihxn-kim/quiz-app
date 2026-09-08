import { z } from 'zod';

/**
 * zod 스키마를 OpenAI 구조화 출력 strict 모드가 받는 JSON Schema 로 바꾼다.
 *
 * `openai/helpers/zod` 의 zodResponseFormat / zodTextFormat 은 쓰지 않는다.
 * 그 헬퍼들은 zod v3 내부구조를 가정하고 있어서 이 프로젝트의 zod v4 스키마를
 * `type: "string"` 으로 망가뜨리고 400 invalid_json_schema 를 낸다.
 *
 * strict 모드는 모든 객체에 additionalProperties: false 와
 * "전체 프로퍼티가 required" 를 요구한다. optional 필드도 예외가 아니다.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<
    string,
    unknown
  >;
  strictify(json);
  return json;
}

function strictify(node: unknown): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) strictify(item);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (obj.type === 'object') {
    obj.additionalProperties = false;
    const properties = obj.properties;
    if (properties !== null && typeof properties === 'object') {
      obj.required = Object.keys(properties as Record<string, unknown>);
    }
  }

  for (const value of Object.values(obj)) strictify(value);
}
