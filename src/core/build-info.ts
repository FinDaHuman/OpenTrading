/**
 * Version and platform of a binary built by scripts/build.ts (set there with `define`).
 * No side effects, unlike ./bundle: `--version` and the updater read it without writing anything.
 */

declare const OPENTRADING_VERSION: string | undefined
declare const OPENTRADING_COMMIT: string | undefined
declare const OPENTRADING_TARGET: string | undefined

export const compiled = typeof OPENTRADING_VERSION !== "undefined"

declare const OPENTRADING_PREBUNDLED: boolean | undefined

/** Running from the shims' prebuilt bundle (src/cli/dev-launch.ts): the JSX is already transformed. */
export const prebundled = typeof OPENTRADING_PREBUNDLED !== "undefined"

/** Build info of a compiled binary; undefined when running the source. */
export const build = compiled ? { version: OPENTRADING_VERSION!, commit: OPENTRADING_COMMIT!, target: OPENTRADING_TARGET! } : undefined
