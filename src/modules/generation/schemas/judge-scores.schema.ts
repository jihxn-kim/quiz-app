import { z } from 'zod';

const score = z.number().int().min(0).max(5);

export const JudgeScoresSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().min(0),
      variance: score,
      accessibility: score,
      concreteness: score,
      curiosity: score,
      reason: z.string(),
    }),
  ),
});

export type JudgeScoreItem = z.infer<typeof JudgeScoresSchema>['items'][number];
