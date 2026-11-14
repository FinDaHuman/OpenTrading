/**
 * The OpenAI-style streamed chat answer the tests' fake fetch returns. Ten files had their own copy
 * of these two.
 */

/** Each chunk as a `data:` event, then `[DONE]`. */
export const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })

/**
 * A `chat.completion.chunk` maker for `model`. `fields` go on every chunk (OpenRouter names the
 * upstream provider there); `extra` on one chunk (usage on the last one).
 */
export const chunkFor =
  (model: string, fields: object = {}) =>
  (delta: object, finish: string | null = null, extra: object = {}) => ({
    id: "c",
    ...fields,
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  })
