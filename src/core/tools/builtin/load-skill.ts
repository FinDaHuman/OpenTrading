import { z } from "zod"
import { readSkillFile } from "../../skills/loader"
import type { Skill } from "../../skills/schema"
import { matchToolPattern } from "../patterns"
import { LOADED_PREFIX } from "../search"
import type { ToolDef } from "../types"

/**
 * Progressive skill loading: the system prompt lists skills (name + when to use), the body
 * is fetched only when the model decides it needs it. `file` reads a supporting file inside
 * the skill's own directory (tables, checklists) — nothing outside it.
 */
export function loadSkillTool(
  skills: () => Skill[],
  /** Deferred (tool-search) tools; those a skill uses are loaded with it. */
  deferrable: () => string[] = () => [],
  /** Every registered tool name: a skill whose requires_tools are missing is hidden, and stays so here. */
  available?: () => ReadonlySet<string>,
): ToolDef<{ name: string; file?: string }> {
  return {
    name: "load_skill",
    description:
      "Nạp hướng dẫn chi tiết của một skill trong danh sách <skill_catalog> rồi làm theo. Tham số file (tuỳ chọn) đọc một file phụ nằm trong thư mục của skill, khi hướng dẫn của skill nhắc tới file đó.",
    input: z.object({
      name: z.string().describe("Tên skill trong danh sách, ví dụ devil-advocate"),
      file: z.string().optional().describe("Đường dẫn tương đối của file phụ trong thư mục skill"),
    }),
    readOnly: true,
    summarize: (input) => `load_skill ${input.name}${input.file ? ` · ${input.file}` : ""}`,
    async execute({ name, file }) {
      const skill = skills().find((s) => s.name === name)
      if (!skill) {
        const names = skills()
          .filter((s) => s.activation === "auto")
          .map((s) => s.name)
          .join(", ")
        throw new Error(`Không có skill "${name}". Các skill hiện có: ${names || "không có"}.`)
      }
      if (skill.activation === "manual") throw new Error(`Skill "${name}" chỉ người dùng bật được (/skill ${name}).`)
      // The catalog hides such a skill; naming it anyway must not load instructions whose
      // tools are not there.
      const tools = available?.()
      const missing = tools ? (skill.requires_tools ?? []).filter((t) => !tools.has(t) && matchToolPattern(t, tools).length === 0) : []
      if (missing.length > 0) {
        throw new Error(`Skill "${name}" đang tắt vì thiếu tool: ${missing.join(", ")} (MCP server chưa kết nối hoặc không có tool này; xem /mcp).`)
      }
      if (file) return readSkillFile(skill, file)
      // A skill is a bundle of instructions + the tools they use: load those tools too, so
      // the model can follow the skill without a tool_search first. First line, so the
      // agent loop still sees it when a long body is cut.
      const pool = deferrable()
      const wanted = skill.uses_tools ?? skill.requires_tools ?? []
      const preload = [...new Set(wanted.flatMap((p) => matchToolPattern(p, pool)))]
      const loaded = preload.length > 0 ? `${LOADED_PREFIX}${preload.join(", ")}\n` : ""
      return `${loaded}Thư mục skill: ${skill.dir}\n\n${skill.body}`
    },
  }
}
