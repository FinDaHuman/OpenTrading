import { expect, test } from "bun:test"
import { toolSetOptions } from "../src/core/agent"
import { modelOutput, stripImages, ToolRegistry } from "../src/core/tools/registry"

const png = { data: "iVBORw0KGgo=", mediaType: "image/png" }

test("tool results carry images only to models that can see them", () => {
  expect(modelOutput({ output: "chụp xong", images: [png] }, true)).toEqual({
    type: "content",
    value: [{ type: "text", text: "chụp xong" }, { type: "image-data", data: png.data, mediaType: "image/png" }],
  })
  expect(modelOutput({ output: "chụp xong", images: [png] }, false)).toEqual({
    type: "text",
    value: "chụp xong\n[ảnh image/png — model này không xem được ảnh]",
  })
  const huge = { data: "A".repeat(8 * 1024 * 1024), mediaType: "image/png" }
  const out = modelOutput({ output: "", images: [huge] }, true)
  expect(out.type).toBe("text")
  expect(modelOutput({ output: "plain" }, true)).toEqual({ type: "text", value: "plain" })
})

test("stripImages turns stored image results into text", () => {
  const messages = [
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "1",
          toolName: "shot",
          output: { type: "content" as const, value: [{ type: "text" as const, text: "ok" }, { type: "image-data" as const, ...png }] },
        },
      ],
    },
  ]
  const [m] = stripImages(messages)
  expect(JSON.stringify(m)).not.toContain(png.data)
  expect((m!.content[0] as { output: unknown }).output).toEqual({ type: "text", value: "ok\n[ảnh image/png — không còn trong lịch sử]" })
})

test("tool set options follow the provider and model", () => {
  const provider = (npm: string, input: string[]) => ({ npm, models: { m: { modalities: { input } }, "google/gemini-2.5-flash": { modalities: { input } } } })
  expect(toolSetOptions({ provider: provider("@ai-sdk/anthropic", ["text", "image"]), model: "m" })).toEqual({ flavor: "default", images: true })
  expect(toolSetOptions({ provider: provider("@ai-sdk/anthropic", ["text"]), model: "m" })).toEqual({ flavor: "default", images: false })
  expect(toolSetOptions({ provider: provider("@ai-sdk/openai-compatible", ["text", "image"]), model: "m" })).toEqual({ flavor: "default", images: false })
  expect(toolSetOptions({ provider: provider("@ai-sdk/google", ["text", "image"]), model: "m" })).toEqual({ flavor: "gemini", images: true })
  expect(toolSetOptions({ provider: provider("@openrouter/ai-sdk-provider", ["text"]), model: "google/gemini-2.5-flash" }).flavor).toBe("gemini")
})

test("schemas are sanitized per flavor and cached per definition", () => {
  const r = new ToolRegistry()
  r.register({
    name: "mcp__s__t",
    description: "d",
    input: { type: "object", properties: { n: { type: "integer", enum: [1, 2] } } },
    readOnly: true,
    execute: async () => "",
  })
  const schemaOf = (set: ReturnType<ToolRegistry["toToolSet"]>) => JSON.stringify((set.tools["mcp__s__t"] as { inputSchema: { jsonSchema: unknown } }).inputSchema.jsonSchema)
  expect(schemaOf(r.toToolSet())).toContain('"enum":[1,2]')
  expect(schemaOf(r.toToolSet({ flavor: "gemini" }))).not.toContain("enum")
  expect(r.toToolSet().tokens).toBeGreaterThan(0)
})
