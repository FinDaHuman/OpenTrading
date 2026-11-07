import { readdir } from "node:fs/promises"
import path from "node:path"
import { loadConfig, saveConfig } from "../config"

/**
 * The legacy memory ("Memory cũ", provider "file": a model tool that proposed memories and a hook that saved
 * "Ghi nhớ: …") was removed in spec 007. A config still naming it is read as the notebook everywhere
 * (memoryChoiceOf); the TUI calls this once at startup to write "notebook" back and say so, in one step, so
 * the notice shows exactly once. The old files are never touched.
 *
 * Returns the notice, or undefined when there was nothing to move.
 */
export async function migrateLegacyMemory(home: string): Promise<string | undefined> {
  if ((await loadConfig()).memory?.provider !== "file") return undefined
  const folder = path.join(home, "memory")
  const files = await readdir(folder)
    .then((names) => names.filter((n) => n.endsWith(".md")).length)
    .catch(() => 0)
  const where =
    files > 0
      ? ` ${files} ghi chú cũ vẫn nằm nguyên ở ${folder}; muốn dùng tiếp thì chép sang bằng /nho (ràng buộc, cách trình bày) hoặc /baihoc.`
      : ""
  try {
    await saveConfig((current) => ({ memory: { ...current.memory, provider: "notebook" } }))
  } catch (error) {
    return `Memory cũ đã được gỡ; lần này dùng Sổ ghi nhớ nhưng chưa ghi được cấu hình (${(error as Error).message}), lần sau sẽ thử lại.${where}`
  }
  return `Memory cũ đã được gỡ; OpenTrading chuyển sang Sổ ghi nhớ (xem, sửa bằng /memory; lưu bằng /nho, /luandiem, /baihoc).${where}`
}
