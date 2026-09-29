import { z } from "zod"
import type { Skill } from "../../skills"
import type { ToolDef } from "../types"

/**
 * Progressive skill loading: the description lists what exists, the body is only
 * fetched when the model decides it needs it.
 */
export function loadSkillTool(skills: () => Skill[]): ToolDef<{ name: string }> {
  const catalogue = () =>
    skills()
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n")
  return {
    name: "load_skill",
    get description() {
      return `Nạp hướng dẫn chi tiết của một skill phân tích rồi làm theo. Các skill hiện có:\n${catalogue() || "(chưa có skill nào)"}`
    },
    input: z.object({ name: z.string().describe("Tên skill, ví dụ devil-advocate") }),
    readOnly: true,
    summarize: (input) => `load_skill ${input.name}`,
    async execute({ name }) {
      const skill = skills().find((s) => s.name === name)
      if (!skill) {
        const names = skills().map((s) => s.name).join(", ") || "không có"
        throw new Error(`Không có skill "${name}". Các skill hiện có: ${names}.`)
      }
      return skill.body
    },
  }
}
