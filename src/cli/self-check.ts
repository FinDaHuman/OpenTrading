/**
 * `opentrading --self-check` (hidden): load what a binary must carry — bundled skills, agents,
 * prompts, the market calendar, OpenTUI's native library and its tree-sitter worker — and exit
 * non-zero when any is missing. scripts/build.ts and CI run it on every fresh binary.
 */
export async function selfCheck(): Promise<number> {
  const { BUNDLED_ROOT } = await import("../core/bundle")
  const { loadSkills } = await import("../core/skills/loader")
  const { loadAgents } = await import("../core/agents/loader")
  const { promptFile } = await import("../core/prompt/assemble")
  const { loadCalendar } = await import("../core/prompt/market-clock")
  const { SKILLS_DIR, AGENTS_DIR } = await import("../core/paths")
  const { resolveRenderLib, getTreeSitterClient, destroyTreeSitterClient } = await import("@opentui/core")

  let failed = false
  const check = async (name: string, run: () => unknown | Promise<unknown>) => {
    try {
      const detail = await run()
      process.stdout.write(`ok   ${name}${detail === undefined ? "" : `: ${detail}`}\n`)
    } catch (error) {
      failed = true
      process.stdout.write(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  process.stdout.write(`bundled ${BUNDLED_ROOT}\n`)
  await check("skills", async () => {
    const set = await loadSkills([{ dir: SKILLS_DIR, source: "bundled" }])
    if (set.skills.length === 0 || set.problems.length) throw new Error(`${set.skills.length} skill, ${set.problems.length} lỗi`)
    return set.skills.length
  })
  await check("agents", async () => {
    const set = await loadAgents([{ dir: AGENTS_DIR, source: "bundled" }])
    if (set.agents.length === 0 || set.problems.length) throw new Error(`${set.agents.length} agent, ${set.problems.length} lỗi`)
    return set.agents.length
  })
  await check("prompts", () => {
    if (!promptFile("identity")) throw new Error("thiếu prompts/identity.md")
  })
  await check("calendar", () => Object.keys(loadCalendar().exchanges).join(","))
  await check("native", () => {
    resolveRenderLib()
  })
  await check("tree-sitter", async () => {
    const client = getTreeSitterClient()
    try {
      const result = await Promise.race([
        client.highlightOnce("# Tiêu đề\n\n```ts\nconst a = 1\n```\n", "markdown"),
        Bun.sleep(20_000).then(() => ({ error: "quá 20s", highlights: undefined })),
      ])
      if (result.error) throw new Error(result.error)
      if (!result.highlights?.length) throw new Error("không có highlight")
      return `${result.highlights.length} highlight`
    } finally {
      await destroyTreeSitterClient()
    }
  })
  return failed ? 1 : 0
}
