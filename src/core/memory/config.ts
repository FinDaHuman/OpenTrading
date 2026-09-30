import { z } from "zod"

/** Hard ceiling for one memory body; config may lower it but never raise it. */
export const MAX_ITEM_BYTES_LIMIT = 4096

export const MemoryConfig = z.object({
  enabled: z.boolean().default(true),
  maxItemBytes: z.number().int().positive().max(MAX_ITEM_BYTES_LIMIT).default(MAX_ITEM_BYTES_LIMIT),
  t1MaxBytes: z.number().int().positive().default(6000),
})
export type MemoryConfig = z.infer<typeof MemoryConfig>

/** Unknown keys are dropped: the full config file also carries settings for later versions. Invalid values throw. */
export const parseMemoryConfig = (input: unknown): MemoryConfig => MemoryConfig.parse(input ?? {})
