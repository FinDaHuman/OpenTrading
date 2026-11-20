import { z } from "zod"
import { findResult, REF_PREFIX } from "../refs"
import type { ToolDef } from "../types"

/** Leaves room under the default output cap, so a page is never cut in the middle. */
const PAGE_CHARS = 25_000

const Input = z.object({
  id: z.string().min(1).describe("The id given in the pruned line, or a ref such as r3."),
  offset: z.number().int().min(0).optional().describe("Start character, when the result is longer than one page."),
})

/** A saved result as it was fetched: the way back to figures an answer already cited. */
export function readResultTool(): ToolDef<z.infer<typeof Input>> {
  return {
    name: "read_result",
    description:
      "Re-reads, verbatim, a tool result already fetched in this session, exactly as it was fetched. " +
      "Use when: you need a figure from a pruned result, to match a figure already quoted. " +
      "Do not use when: you need the latest figure; call the data tool again instead.",
    input: Input,
    readOnly: true,
    summarize: ({ id }) => `read_result(${id})`,
    async execute({ id, offset = 0 }) {
      const found = findResult(id)
      if (!found) return `Result "${id}" is no longer in the open session. Call the data tool again; figures may differ from those already quoted, so state the new time.`
      const page = found.text.slice(offset, offset + PAGE_CHARS)
      const left = found.text.length - offset - page.length
      const head = `[${found.tool} · fetched at ${found.at}]\n${found.ref && offset === 0 ? `${REF_PREFIX}${found.ref}] ` : ""}`
      return `${head}${page}${left > 0 ? `\n[${left} characters left: call again with offset ${offset + page.length}]` : ""}`
    },
  }
}
