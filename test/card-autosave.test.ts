import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { cardsAutoSave } from "../src/core/config"
import { notebookAdmin } from "../src/core/memory/notebook/admin"
import { openNotebook } from "../src/core/memory/notebook/lifecycle"
import { saveCardNow } from "../src/tui/dialogs/notebook-form/open"

/** Config memory.cardsAutoSave (issue #307, #309 C2): only quoted rule and style cards are saved without the form. */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-card-autosave-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

test("off unless set to true", () => {
  expect(cardsAutoSave({})).toBe(false)
  expect(cardsAutoSave({ memory: { cardsAutoSave: true } })).toBe(true)
})

test("a quoted constraint or style card is saved; a lesson or an unquoted card is not", () => {
  const memory = openNotebook(path.join(root, "memory.db"))
  // Windows locks an open database file: close it before afterAll removes the folder.
  try {
  const saved = saveCardNow(memory, { kind: "constraint", text: "Không gợi ý cổ phiếu ngân hàng", quote: "không bao giờ gợi ý cổ phiếu ngân hàng" })
  expect(saved?.group).toBe("constraint")
  expect(notebookAdmin(memory)!.entries().some((e) => e.group === "constraint" && e.id === saved!.id && e.text === "Không gợi ý cổ phiếu ngân hàng")).toBe(true)
  expect(saveCardNow(memory, { kind: "style", text: "Luôn có bảng so sánh", quote: "luôn có bảng so sánh nhé" })?.group).toBe("style")
  expect(saveCardNow(memory, { kind: "lesson", title: "Cắt lỗ", summary: "Cắt lỗ 7%" })).toBeUndefined()
  expect(saveCardNow(memory, { kind: "constraint", text: "Không margin" })).toBeUndefined()
  } finally {
    memory.close()
  }
})
