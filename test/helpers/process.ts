/** Wait for an explicit child readiness marker, with EOF and timeout diagnostics. */
export async function waitForOutput(stream: ReadableStream<Uint8Array>, marker: string, ms = 5_000) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`child did not print ${JSON.stringify(marker)} within ${ms} ms; stdout: ${output}`)), ms)
  })
  try {
    while (!output.includes(marker)) {
      const chunk = await Promise.race([reader.read(), timeout])
      if (chunk.done) throw new Error(`child stdout ended before ${JSON.stringify(marker)}; stdout: ${output}`)
      output += decoder.decode(chunk.value, { stream: true })
    }
    return output
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
