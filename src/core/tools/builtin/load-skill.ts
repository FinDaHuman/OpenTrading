import { z } from "zod"
import { readSkillFile } from "../../skills/loader"
import type { Skill } from "../../skills/schema"
import type { ToolDef } from "../types"

/**
 * Progressive skill loading: the system prompt lists skills (name + when to use), the body
 * is fetched only when the model decides it needs it. `file` reads a supporting file inside
 * the skill's own directory (tables, checklists) — nothing outside it.
 */
export function loadSkillTool(skills: () => Skill[]): ToolDef<{ name: string; file?: string }> {
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
      if (file) return readSkillFile(skill, file)
      return `Thư mục skill: ${skill.dir}\n\n${skill.body}`
    },
  }
}
