import { z } from "zod"

/** Hard ceiling for one memory body; config may lower it but never raise it. */
export const MAX_ITEM_BYTES_LIMIT = 4096

export const MemoryConfig = z.object({
  enabled: z.boolean().default(true),
  maxItemBytes: z.number().int().positive().max(MAX_ITEM_BYTES_LIMIT).default(MAX_ITEM_BYTES_LIMIT),
  /** Cap for the stable block (always-on rules, global profiles and lessons). */
  t1MaxBytes: z.number().int().positive().default(6000),
  /** Cap for the per-turn block (notes, scoped lessons and rules for the tickers being discussed). */
  projectionMaxBytes: z.number().int().positive().default(4000),
  /**
   * Used when the harness does not say how much room memory has on this model. Small enough to fit the
   * smallest model tier, so the harness never has to cut the block in the middle of an item.
   */
  indexMaxChars: z.number().int().positive().default(1200),
  maxEntities: z.number().int().positive().default(5),
  entityTtlTurns: z.number().int().positive().default(6),
  maxProposalsPerDay: z.number().int().nonnegative().default(3),
  autoDisable: z
    .object({ window: z.number().int().positive().default(5), harmful: z.number().int().positive().default(2) })
    .default({ window: 5, harmful: 2 }),
  suggestedNoteTtlDays: z
    .object({ market: z.number().int().positive().default(30), method: z.number().int().positive().default(180) })
    .default({ market: 30, method: 180 }),
  /** T3: a small model picks extra memories when the store outgrows T1/T2. Off by default. */
  t3: z.enum(["off", "llm"]).default("off"),
  t3TimeoutMs: z.number().int().positive().default(3000),
  timezone: z.string().default("Asia/Ho_Chi_Minh"),
})
export type MemoryConfig = z.infer<typeof MemoryConfig>

/** Unknown keys are dropped: the full config file also carries settings for other modules. Invalid values throw. */
export const parseMemoryConfig = (input: unknown): MemoryConfig => MemoryConfig.parse(input ?? {})
