import { z } from "zod"
import type { ToolDef } from "../types"

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]

/** Vietnam wall-clock time. Deterministic, so the model never guesses "now". */
export function currentTimeTool(now: () => Date = () => new Date()): ToolDef<Record<string, never>> {
  return {
    name: "current_time",
    description:
      "Trả về ngày giờ hiện tại theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7) và thứ trong tuần. Dùng khi cần biết hôm nay là ngày nào hoặc bây giờ là mấy giờ.",
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
        `${weekday}, ${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second} (giờ Việt Nam, UTC+7)`,
        `ISO: ${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`,
      ].join("\n")
    },
  }
}
