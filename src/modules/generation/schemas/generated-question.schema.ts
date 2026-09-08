import { z } from 'zod';

import { TOPIC_TAGS } from '../prompts/shared.prompt';

export const GeneratedQuestionsSchema = z.object({
  items: z.array(
    z.object({
      text: z.string().min(5),
      // 자유 문자열로 두면 모델이 허용 목록 밖의 태그를 지어낸다(실측 확인).
      // 스키마에 열거형으로 박아 구조화 출력 단계에서 강제한다.
      topicTags: z.array(z.enum(TOPIC_TAGS)).min(1),
      seedHash: z.string(),
    }),
  ),
});

export type GeneratedQuestion = z.infer<
  typeof GeneratedQuestionsSchema
>['items'][number];
