import { readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** An image attached to the prompt, base64 like the providers want it. */
export type PromptImage = { data: string; mediaType: string }

/** Anthropic's per-image cap is 5 MB of base64; Claude Code aims at 3.75 MB of raw bytes. */
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024
const TARGET_BYTES = 3.75 * 1024 * 1024
/** Longest side kept (Claude Code resizes to 2000×2000). */
const MAX_SIDE = 2000

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i

/** The media type from the file's first bytes (the extension can lie). */
export function sniffImage(bytes: Uint8Array): string | undefined {
  const b = bytes
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp"
  return undefined
}

/**
 * A pasted or dragged-in path to an image: one line, optional quotes, `file://` URLs,
 * shell-escaped spaces (except on Windows, where `\` is the separator).
 */
export function imagePath(text: string, platform: NodeJS.Platform = process.platform): string | undefined {
  let value = text.trim()
  if (!value || value.includes("\n")) return undefined
  value = value.replace(/^(['"])(.*)\1$/, "$2").replace(/^& ['"](.*)['"]$/, "$1")
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(new URL(value).pathname)
      if (platform === "win32") value = value.replace(/^\/([A-Za-z]:)/, "$1")
    } catch {
      return undefined
    }
  } else if (platform !== "win32") value = value.replace(/\\(.)/g, "$1")
  if (!IMAGE_EXTENSIONS.test(value) || !path.isAbsolute(value)) return undefined
  return value
}

type Spawn = (command: string[]) => Promise<{ code: number; stdout: string }>

const spawnText: Spawn = async (command) => {
  try {
    const proc = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => proc.kill(), 15_000)
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    return { code, stdout }
  } catch {
    return { code: -1, stdout: "" }
  }
}

/**
 * PowerShell that takes the clipboard image (or a file), shrinks it to MAX_SIDE, and
 * prints "<mime>\n<base64>": PNG, or JPEG when the PNG would still be too large.
 * System.Drawing ships with Windows PowerShell, so no image library is needed.
 */
function windowsScript(source: { file: string } | "clipboard") {
  const load =
    source === "clipboard"
      ? "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if (-not $img) { exit 3 }"
      : `$img = [System.Drawing.Image]::FromFile('${source.file.replaceAll("'", "''")}')`
  return [
    "Add-Type -AssemblyName System.Drawing",
    load,
    `$max = ${MAX_SIDE}; $scale = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))`,
    "if ($scale -lt 1.0) { $w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale); $bmp = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose(); $img = $bmp }",
    "$ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $mime = 'image/png'",
    `if ($ms.Length -gt ${TARGET_BYTES}) { $ms = New-Object System.IO.MemoryStream; $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $p = New-Object System.Drawing.Imaging.EncoderParameters 1; $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L; $img.Save($ms, $codec, $p); $mime = 'image/jpeg' }`,
    "[Console]::Out.Write($mime + \"`n\" + [Convert]::ToBase64String($ms.ToArray()))",
  ].join("; ")
}

const powershell = (script: string) => ["powershell.exe", "-NonInteractive", "-NoProfile", "-STA", "-Command", script]

function parseScriptOutput(stdout: string): PromptImage | undefined {
  const [mime, data] = stdout.trim().split("\n")
  if (!mime?.startsWith("image/") || !data) return undefined
  return { mediaType: mime.trim(), data: data.trim() }
}

async function fromBytes(bytes: Uint8Array): Promise<PromptImage | undefined> {
  const mediaType = sniffImage(bytes)
  if (!mediaType || bytes.length === 0) return undefined
  return { mediaType, data: Buffer.from(bytes).toString("base64") }
}

/** The image on the system clipboard, or undefined when there is none. */
async function readClipboardImageOs(spawn: Spawn = spawnText): Promise<PromptImage | undefined> {
  if (process.platform === "win32") {
    const out = await spawn(powershell(windowsScript("clipboard")))
    return out.code === 0 ? parseScriptOutput(out.stdout) : undefined
  }
  if (process.platform === "darwin") {
    const file = path.join(os.tmpdir(), `opentrading-clipboard-${process.pid}.png`)
    const script = `set f to open for access POSIX file "${file}" with write permission\nset eof f to 0\nwrite (the clipboard as «class PNGf») to f\nclose access f`
    const out = await spawn(["osascript", "-e", script])
    if (out.code !== 0) return undefined
    await spawn(["sips", "-Z", String(MAX_SIDE), file])
    try {
      return await fromBytes(await readFile(file))
    } finally {
      await rm(file, { force: true })
    }
  }
  for (const command of [
    ["wl-paste", "--no-newline", "--type", "image/png"],
    ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
  ]) {
    if (!Bun.which(command[0]!)) continue
    try {
      const proc = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
      const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
      if ((await proc.exited) === 0) return await fromBytes(bytes)
    } catch {
      // try the next tool
    }
  }
  return undefined
}

/** An image file, shrunk on Windows when it is too big to send as is. */
async function readImageFileOs(file: string, spawn: Spawn = spawnText): Promise<PromptImage | undefined> {
  try {
    if (!(await stat(file)).isFile()) return undefined
    const bytes = await readFile(file)
    const image = await fromBytes(bytes)
    if (!image) return undefined
    if (bytes.length <= TARGET_BYTES || process.platform !== "win32") return image
    const out = await spawn(powershell(windowsScript({ file })))
    return (out.code === 0 && parseScriptOutput(out.stdout)) || image
  } catch {
    return undefined
  }
}

export type ImageReader = {
  clipboard: () => Promise<PromptImage | undefined>
  file: (path: string) => Promise<PromptImage | undefined>
}

const osReader: ImageReader = { clipboard: () => readClipboardImageOs(), file: (f) => readImageFileOs(f) }
let reader: ImageReader = osReader

/** Tests replace the OS side so CI never starts powershell or osascript. */
export function setImageReader(next: Partial<ImageReader> | undefined) {
  reader = next ? { ...osReader, ...next } : osReader
}

export const readClipboardImage = () => reader.clipboard()
export const readImageFile = (file: string) => reader.file(file)
