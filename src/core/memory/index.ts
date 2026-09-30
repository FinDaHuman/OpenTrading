/**
 * Public surface of the memory module. Code outside src/core/memory imports from here only.
 * `createMemoryService` is the capability root: only test/, scripts/ (with temporary databases) and the one
 * production composition root may import it; an architecture test enforces that list.
 */
export type {
  ContextBudget,
  ContextContribution,
  EntityState,
  InjectionRef,
  MemoryPort,
  MemoryWarning,
  MemoryWarningCode,
  PurgeResult,
  RememberFailureCode,
  RememberResult,
  TurnContextV0,
  UserMemoryCommands,
} from "./port"
export type { AmbiguousReason, RejectReason } from "./content"
export type { MemoryItemV0 } from "./schema"
export { type MemoryConfig, parseMemoryConfig } from "./config"
export { type Clock, type IdFactory, systemClock, uuidV7Ids } from "./deps"
export { createMemoryService, type MemoryService, type MemoryServiceDeps } from "./service"
