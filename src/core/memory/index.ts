/**
 * Public surface of the memory module. Code outside src/core/memory imports from here only; the harness contract in
 * ./types (MemoryProvider), which the agent loop and /memory use directly, is the one exception.
 * `createMemoryService` is the capability root: only test/, scripts/ (with temporary databases) and the one
 * production composition root may import it; an architecture test enforces that list.
 */
export type {
  ContextBudget,
  ContextContribution,
  EntityState,
  FeedbackResult,
  InjectionRef,
  MemoryHit,
  MemoryPort,
  MemoryWarning,
  MemoryWarningCode,
  ProposeResult,
  PurgeResult,
  RememberFailureCode,
  RememberResult,
  SystemMemory,
  TransitionResult,
  TurnContext,
  TurnContextV0,
  UserMemoryCommands,
  WriteFailureCode,
  WriteOptions,
} from "./port"
export type { AmbiguousReason, RejectReason } from "./content"
export type { MemoryItem } from "./schema"
export type { T3Selector } from "./t3"
export { type MemoryConfig, parseMemoryConfig } from "./config"
export { type Clock, type IdFactory, systemClock, uuidV7Ids } from "./deps"
export { createMemoryService, type MemoryService, type MemoryServiceDeps } from "./service"
export { createMemoryProvider, type ProviderOptions } from "./provider"
