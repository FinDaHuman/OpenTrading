/**
 * Waits that hold up on a busy machine.
 *
 * OpenTUI's `waitFor` / `waitForFrame` give up after 20 frames (about 0.33 s at 60 fps), whatever
 * `--timeout` says. With every CPU busy (bun test --parallel), file reads such as loading the skills
 * at startup take seconds, so a step that waits for disk or network work there fails on a correct
 * app. Wait for that work in real time with `until`, then read the screen.
 */

/** Resolves once `check` holds; throws after `ms` of real time. */
export async function until(check: () => boolean | Promise<boolean>, ms = 10_000, what = "the condition") {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

interface Capturable {
  renderer: { getSchedulerState(): { isRendering: boolean } }
  captureCharFrame(): string
}

/**
 * The current frame, read once no render is running: reading the buffer while a render holds it
 * fails with the native error `OutputBusy` (a spinner's own render request can start at any time).
 */
export async function captureIdle(setup: Capturable, ms = 5_000) {
  await until(() => !setup.renderer.getSchedulerState().isRendering, ms, "the renderer to finish a frame")
  return setup.captureCharFrame()
}
