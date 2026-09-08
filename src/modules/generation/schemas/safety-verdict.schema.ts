import { z } from 'zod';

export const SafetyVerdictsSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().min(0),
      passed: z.boolean(),
      reason: z.string(),
    }),
  ),
});
