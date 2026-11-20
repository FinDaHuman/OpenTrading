import { z } from "zod"
import type { ToolDef } from "../types"

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** Vietnam wall-clock time. Deterministic, so the model never guesses "now". */
export function currentTimeTool(now: () => Date = () => new Date()): ToolDef<Record<string, never>> {
  return {
    name: "current_time",
    description:
      "Returns the current date and time in Vietnam (Asia/Ho_Chi_Minh, UTC+7) and the weekday. Use when you need today's date or the current time.",
    input: z.object({}),
    readOnly: true,
    summarize: () => "current_time()",
    async execute() {
      const date = now()
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
          weekday: "short",
        })
          .formatToParts(date)
          .map((p) => [p.type, p.value]),
      )
      const weekday = WEEKDAYS[new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`).getUTCDay()]
      return [
        `${weekday}, ${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second} (Vietnam time, UTC+7)`,
        `ISO: ${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`,
      ].join("\n")
    },
  }
}
