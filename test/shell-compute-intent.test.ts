import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { classifyOutcome } from "../src/core/loop/failures"
import { PermissionGate } from "../src/core/permission"
import { computeIntent } from "../src/core/tools/shell/math"
import { MATH_NEAR_MISS_PREFIX, shellTool } from "../src/core/tools/shell/shell"
import { RwLock, runTool } from "../src/core/tools/wrap"

/**
 * Arithmetic written in a form the math grammar does not take (issue #268, run R0 of 14/11): the
 * model is told the form that runs, where it used to be asked for an approval nobody could give.
 */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-compute-intent-"))
const data = path.join(root, "home", ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ws = () => new Workspace(project, { home: path.join(root, "home"), data })
const PS = { kind: "powershell" as const, path: "powershell" }
const BASH = { kind: "bash" as const, path: "bash" }
const ctx = () => ({ signal: new AbortController().signal, callId: "c" })
const failure = (run: Promise<unknown>) =>
  run.then(
    () => "",
    (e: Error) => e.message,
  )

// The commands of run R0 that were denied, shortened.
const AWK_LOOP = `awk 'BEGIN{
  n = split("25.1 25.3 25 24.8", a, " ");
  sum = 0;
  for (i = 1; i <= n; i++) sum += a[i];
  printf "%.3f", sum/n
}'`
const AWK_DRAWDOWN = `awk 'BEGIN {
    n = split("48.5 50.2 51.8 49.9", prices, " ");
    max_price = 0; max_drawdown = 0;
    for (i = 1; i <= n; i++) {
        if (prices[i] > max_price) { max_price = prices[i]; }
        drawdown = (max_price - prices[i]) / max_price;
        if (drawdown > max_drawdown) { max_drawdown = drawdown; }
    }
    printf "%.3f\\n", max_drawdown * 100;
}'`
const PS_FOREACH = "$data = @(12000000, 13419003, 14838006)\n$sum = 0\nforeach ($n in $data) { $sum += $n }\n$avg = $sum / $data.Count\n$last = $data[-1]\n[math]::Round(($last / $avg) * 100, 2)"
const PS_PIPELINE =
  "$prices = @(61.2, 61.9, 61.4)\n$returns = for ($i = 1; $i -lt $prices.Count; $i++) { [Math]::Log($prices[$i] / $prices[$i-1]) }\n$mean = ($returns | Measure-Object -Average).Average\n$variance = ($returns | ForEach-Object { [Math]::Pow($_ - $mean, 2) } | Measure-Object -Sum).Sum / 2\n[Math]::Round([Math]::Sqrt($variance) * [Math]::Sqrt(250) * 100, 3)"
const PY_MULTILINE = 'python3 -c "\nimport math\nk = 250/119\nprint(round(math.log(66.3/73.5)*k, 4))\n"'
const PY_HEREDOC = "cat > /tmp/calc.py << 'EOF'\nimport math\nrets = [0.012, -0.004, 0.021]\nprint(math.sqrt(sum(r*r for r in rets)/len(rets))*math.sqrt(250))\nEOF\npython3 /tmp/calc.py"

test("computeIntent names why arithmetic missed the grammar: a series, an interpreter, another form", () => {
  for (const c of [AWK_LOOP, AWK_DRAWDOWN]) expect(computeIntent(c, BASH), c).toBe("series")
  for (const c of [PS_FOREACH, PS_PIPELINE]) expect(computeIntent(c, PS), c).toBe("series")
  for (const c of [PY_MULTILINE, PY_HEREDOC, 'python3 -c "print((128.4/112-1)*100)"', "python3 - <<'EOF'\nprint(1.08**3)\nEOF", 'node -e "console.log(2**10)"']) expect(computeIntent(c, BASH), c).toBe("interpreter")
  expect(computeIntent('python -c "print(1.2*3)"', PS)).toBe("interpreter")
  for (const c of ["1,2*3", "2^3", "echo $((1+2))", "expr 3 + 4", '$x = 5; "{0:N2}" -f ($x * 1.5)', "$x = 5; Write-Output ($x*2)"]) expect(computeIntent(c, PS), c).toBe("form")
  for (const c of ["3/2", "echo 1.5*3 | bc -l", `awk -v x=5 'BEGIN{print x*2}'`, `awk 'BEGIN{ printf "%s\\n", 1/3 }'`, `awk 'BEGIN{print 2**3}'`]) expect(computeIntent(c, BASH), c).toBe("form")
  // What the grammar takes is no miss.
  expect(computeIntent("$x = 5; $x*2", PS)).toBeUndefined()
  expect(computeIntent(`awk 'BEGIN{x = 5; print x*2}'`, BASH)).toBeUndefined()
})

test("computeIntent says no to anything that does more than print numbers: the user is still asked about those", () => {
  for (const c of [
    // Another module, a file, the system.
    'python3 -c "import pandas as pd; print(pd.read_csv(\'gia.csv\').close.mean())"',
    'python3 -c "import os; print(os.listdir(\'.\'))"',
    "python3 -c \"print(open('/etc/passwd').read())\"",
    'python3 -c "print(__import__(\'os\').getcwd())"',
    'python3 -c "import subprocess; print(subprocess.run([\'id\']))"',
    'python3 -c "x = 1"', // prints nothing
    "python3 phan_tich.py",
    "python3 - <<'EOF'\nimport requests\nprint(requests.get('http://x').text)\nEOF",
    "cat > /tmp/a.py << 'EOF'\nprint(1)\nEOF\npython3 /tmp/b.py", // runs another file
    "node -e \"console.log(require('fs').readdirSync('.'))\"",
    'node -e "console.log(process.env.HOME, 1)"',
    // awk beyond printing numbers.
    `awk 'BEGIN{print 1 > "/tmp/x"}'`,
    `awk 'BEGIN{a = 1; b = 2; print a > b}'`,
    `awk 'BEGIN{print 1 | "sh"}'`,
    `awk 'BEGIN{system("id"); print 1}'`,
    `awk 'BEGIN{"date" | getline d; print d, 1}'`,
    `awk 'BEGIN{print ENVIRON["HOME"], 1}'`,
    `awk 'BEGIN{x = 1}'`, // prints nothing
    `awk 'BEGIN{print 1}' /etc/passwd`,
    `awk '{s += $1} END{print s/NR}' gia.txt`,
    `awk -f calc.awk`,
    "ls -la",
    "date +%s",
    "git status",
  ]) expect(computeIntent(c, BASH), c).toBeUndefined()
  for (const c of [
    "Get-ChildItem | Measure-Object",
    "Get-Content gia.csv | Measure-Object -Average",
    "$x = 1; Remove-Item x",
    "$env:PATH",
    "$x = Get-Date; $x",
    "@(1,2) | Out-File x",
    "Import-Csv gia.csv | ForEach-Object { $_.close * 2 }",
    "[IO.File]::ReadAllText('a')",
    "iex '1+1'",
    "Get-Date",
    "1",
  ]) expect(computeIntent(c, PS), c).toBeUndefined()
})

test("the hint says what was wrong and shows the form to use; it reads as a tool error, not as a denial", async () => {
  const sh = shellTool(ws(), { shell: BASH })
  const ps = shellTool(ws(), { shell: PS })
  const series = sh.rewrite!({ command: AWK_LOOP })!
  expect(series).toStartWith(MATH_NEAR_MISS_PREFIX)
  expect(series).toContain("arrays or loops")
  expect(series).toContain("(a+b+c)/3")
  expect(series).toContain("awk 'BEGIN{ g = ")
  expect(ps.rewrite!({ command: PS_FOREACH })).toContain("$g = 128.4/112 - 1")
  expect(sh.rewrite!({ command: PY_MULTILINE })).toContain("Python or Node. Rewrite that calculation as awk")
  expect(ps.rewrite!({ command: 'python -c "print(1.2*3)"' })).toContain("as a PowerShell expression")
  // The right form with a folder it does not need.
  expect(ps.rewrite!({ command: "3/2", workdir: project })).toContain("without workdir")
  expect(ps.rewrite!({ command: "3/2" })).toBeUndefined()
  expect(sh.rewrite!({ command: "python3 phan_tich.py" })).toBeUndefined()
  // Stop-gate and eval traces sort it with tool errors (the model fixes those), never with denials.
  expect(classifyOutcome(false, series)).toBe("tool-error")
  for (const word of ["Không chạy.", "DỪNG", "lách", "Người dùng từ chối"]) expect(series).not.toContain(word)
})

test("the gate answers with the hint where it would have asked, in every mode that asks, with no classifier request", async () => {
  const tool = shellTool(ws(), { shell: BASH })
  const signal = new AbortController().signal
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  for (const mode of ["read-only", "ask"] as const) {
    gate.setMode(mode)
    for (const interactive of [false, true]) {
      // Interactive too: the user is not shown an approval box for a sum.
      gate.interactive = interactive
      expect(await gate.check(tool, { command: AWK_LOOP }, signal)).toMatchObject({ allow: false, reason: "rewrite" })
      expect(gate.pending()).toHaveLength(0)
    }
  }
  gate.interactive = false
  let reviews = 0
  ;(gate as unknown as { auto: unknown }).auto = {
    log: { action() {}, denied() {}, approved() {} },
    ranWithoutBlock() {},
    review: async () => {
      reviews++
      return { decision: "allow" }
    },
  }
  gate.setMode("auto")
  expect(await gate.check(tool, { command: PY_MULTILINE }, signal)).toMatchObject({ allow: false, reason: "rewrite" })
  expect(reviews).toBe(0)
  // A command that is not arithmetic still goes to the classifier, or is refused headless.
  expect(await gate.check(tool, { command: "python3 phan_tich.py" }, signal)).toEqual({ allow: true })
  expect(reviews).toBe(1)
  gate.setMode("ask")
  expect(await gate.check(tool, { command: "python3 phan_tich.py" }, signal)).toMatchObject({ allow: false, reason: "headless" })
})

test("a command the user already allowed runs as written: ▸▸▸, a session approval, an 'always' rule; an ask rule still asks", async () => {
  const tool = shellTool(ws(), { shell: BASH })
  const signal = new AbortController().signal
  const command = 'python3 -c "print((128.4/112-1)*100)"'
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.bypassAvailable = true
  gate.setMode("bypass")
  expect(await gate.check(tool, { command }, signal)).toEqual({ allow: true })

  const scope = tool.askFor!({ command })!
  const always = new PermissionGate({ load: async () => [{ tool: "shell", scope: `native#${scope}` }], save: async () => {} })
  always.setMode("ask")
  expect(await always.check(tool, { command }, signal)).toEqual({ allow: true })
  // ‖ ignores stored approvals for a shell command, so there the hint applies again.
  always.setMode("read-only")
  expect(await always.check(tool, { command }, signal)).toMatchObject({ allow: false, reason: "rewrite" })

  const asking = new PermissionGate({ load: async () => [], save: async () => {}, lists: async () => ({ deny: [], ask: [{ tool: "shell", pattern: "python3*" }] }) })
  await asking.refreshRules()
  asking.setMode("ask")
  // The user asked to see python commands: no hint, and with nobody to ask it is refused.
  expect(await asking.check(tool, { command }, signal)).toMatchObject({ allow: false, reason: "headless" })
})

test("through runTool: the model reads the hint as the tool's error, and the same command runs once rewritten", async () => {
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.setMode("read-only")
  const tool = shellTool(ws())
  const win = process.platform === "win32"
  const error = await failure(runTool(tool, { command: win ? PS_FOREACH : AWK_LOOP }, ctx(), new RwLock(), gate))
  expect(error).toStartWith(MATH_NEAR_MISS_PREFIX)
  expect(error).toContain("arrays or loops")
  if (!win && !Bun.which("awk")) return
  const rewritten = win ? "$s = 12000000 + 13419003 + 14838006\n$avg = $s/3\n14838006/$avg*100" : `awk 'BEGIN{ s = 25.1 + 25.3 + 25 + 24.8; printf "%.3f\\n", s/4 }'`
  const out = await runTool(tool, { command: rewritten }, ctx(), new RwLock(), gate)
  expect(typeof out === "string" ? out : out.output).toContain(win ? "110.57" : "25.050")
}, 30_000)

test("a read-only agent's calculator gives the same hint for arithmetic, and its plain refusal for anything else", async () => {
  const calculator = shellTool(ws(), { shell: BASH }).readOnlyVariant!
  const hint = await failure(calculator.execute({ command: AWK_LOOP }, ctx()))
  expect(hint).toStartWith(MATH_NEAR_MISS_PREFIX)
  expect(hint).toContain("arrays or loops")
  const refusal = await failure(calculator.execute({ command: "cat gia.csv" }, ctx()))
  expect(refusal).toContain("is not pure arithmetic")
})

test("15/11: a series built with a .NET List and .Add gets the hint; New-Object of anything else does not", () => {
  const PSK = { kind: "powershell" as const }
  const listed =
    "$prices = @(61.2, 61.9, 61.4, 62.3)\n$returns = New-Object System.Collections.Generic.List[double]\nfor ($i = 1; $i -lt $prices.Count; $i++) {\n    $r = [Math]::Log($prices[$i] / $prices[$i-1])\n    $returns.Add($r)\n}\n$mean = ($returns | Measure-Object -Average).Average\n$sumSq = 0\nforeach ($r in $returns) {\n    $sumSq += [Math]::Pow($r - $mean, 2)\n}\n$stdDev = [Math]::Sqrt($sumSq / ($returns.Count - 1))\n\"{0:N3}%\" -f ($stdDev * [Math]::Sqrt(250) * 100)"
  expect(computeIntent(listed, PSK)).toBe("series")
  expect(computeIntent("$a = New-Object System.Collections.ArrayList\n$a.Add(1.5)\n$a.Add(2)\n($a | Measure-Object -Sum).Sum / 2", PSK)).toBe("series")
  for (const c of [
    "$c = New-Object System.Net.WebClient; $c.DownloadString('http://x')",
    "$p = New-Object System.Diagnostics.Process; 1+1",
    "$l = New-Object System.Collections.Generic.List[string]; $l.Add('a')",
    "New-Object -ComObject WScript.Shell",
    "$f = New-Object System.IO.StreamWriter('a.txt'); $f.Write(1)",
  ]) expect([c, computeIntent(c, PSK)]).toEqual([c, undefined])
})
