import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { computeIntent, mathOnlyCommand } from "../src/core/tools/shell/math"
import { shellArgs } from "../src/core/tools/shell/run"
import { shellTool } from "../src/core/tools/shell/shell"

/**
 * Issue #268: a PowerShell calculation that prints a label next to its number. The grammar is a
 * security boundary (such a command runs with no prompt), so most of this file is hostile.
 */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-shell-labels-"))
const data = path.join(root, "home", ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const win = process.platform === "win32"
/** Every PowerShell here: Windows PowerShell 5.1 and PowerShell 7 (the CI runners have both, Linux the second). */
const ENGINES = [...(win ? [["powershell", Bun.which("powershell")] as const] : []), ["pwsh", Bun.which("pwsh")] as const].filter((e): e is readonly ["powershell" | "pwsh", string] => !!e[1])
const ws = () => new Workspace(project, { home: path.join(root, "home"), data })
const PS = { kind: "powershell" as const }
const PS_SHELL = { kind: "powershell" as const, path: "powershell" }
const BASH = { kind: "bash" as const }

/** Accepted commands and what PowerShell prints for them. */
const OK: [string, string][] = [
  // The forms of the 25/11 measurement.
  ['$r = 62.849 / 35.657; $cagr = ([math]::Pow($r, 1/4) - 1) * 100; "cagr % = $cagr"; [math]::Round($cagr, 3)', "cagr % = 15.22"],
  ['$g = 25.1+25.3; "Tong = " + $g; "MA2 = " + ($g/2); [math]::Round($g/2,3)', "MA2 = 25.2"],
  ['$g = [math]::Log(73.5/66.3); "log return (%) = " + [math]::Round($g*100,3)', "log return (%) = 10.31"],
  ['$b = 44; $e = 70; $r = $e / $b; "ratio={0:F6}" -f $r; "cagr={0:P2}" -f $r; "x={0:N3}" -f ($r*100)', "x=159.091"],
  ['$p1=50.1; $p0=58.0; $r=($p1-$p0)/$p0; "FPT: ("+$p1+"-"+$p0+")/"+$p0+" = "+[math]::Round($r*100,4)+" %"', "FPT: (50.1-58)/58 = -13.6207 %"],
  ['$a = 100*1.5; [math]::Round($a); "tiến giữa: $a"', "tiến giữa: 150"],
  ['$p=2400000000; $r=0.093/12; $n=180; "(1+r)^n = " + [math]::Pow(1+$r,$n); "lai thang = $r"', "lai thang = 0.00775"],
  // Around them.
  ['$Tong = 3/2; "Tổng (tỷ đồng) = $TONG"', "Tổng (tỷ đồng) = 1.5"],
  ['$a=1;$b=2;"$a, $b; $a/$b=$a%: ($b) $a. $b"', "1, 2; 1/2=1%: (2) 1. 2"],
  ['"a = " + 1 + "; b = " + -2 * 3', "a = 1; b = -6"],
  ['$x = 5\r\n"x = $x" # ghi chú "dở dang\r\n"het"', "x = 5"],
  ['"{0:N2} và {1:E3}, {0} {2:G4}%" -f 1234.5, (2*3), [math]::Round(1.23456, 4)', "1,234.50 và 6.000E+000, 1234.5 1.235%"],
  ['"k={0:f1}" -F 2', "k=2.0"],
  ['"k={0}"-f$x;1', ""], // replaced below: $x must be assigned
  ['"" + 5', "5"],
]
OK.splice(OK.findIndex(([c]) => c.includes("-f$x")), 1, ['$x=2;"k={0}"-f$x', "k=2"])

test("PowerShell labels: plain text with $name, text + number, a literal format with numbers", () => {
  for (const [c] of OK) expect(mathOnlyCommand(c, PS), c).toBe(true)
})

const CR = "\r"
const HOSTILE = [
  // ── what PowerShell expands or runs in a string ──
  '"$(Get-Date) 1"; 1',
  '$x = 1; "$($x)"',
  '$x = 1; "a $( $x )"',
  '$x = 1; "${x}"',
  '$x = 1; "${env:PATH}"',
  '"$env:PATH"; 1',
  '$env = 1; "$env:PATH"',
  '$x = 1; "$x:"',
  '$x = 1; "$x: b"',
  '$x = 1; "$x::b"',
  '$global = 1; "$global:x"',
  '$script = 1; "$script:x"',
  '$c = 1; "$c:"',
  '$function = 1; "$function:prompt"',
  '$variable = 1; "$variable:pid"',
  '$x = 1; "$x.Length"',
  '$x = 1; "$x.5"',
  '$x = 1; "$x[0]"',
  '$x = 1; "$x("',
  '$x = 1; "$x?"', // PowerShell reads the variable `x?`
  '$x = 1; "$x? b"',
  '$x = 1; "$xy"', // never assigned
  '"$y"; 1',
  '"x = $x"; $x = 1', // assigned later
  '$x = 1; "$x_"',
  '$r = 1; "$ròng"', // `$ròng` is another variable
  '$r = 1; "$ro\u0300ng"',
  '$r = 1; "$r\u0300"', // a combining mark right after the name
  '$x = 1; "$x\u0661"', // a digit to PowerShell
  '$x = 1; "$x\u4e00"',
  '"$pid 1"; 1',
  '"$PSVersionTable"; 1',
  '"$_"; 1',
  '"$args"; 1',
  '"$true"; 1',
  '"$$"; 1',
  '"$^"; 1',
  '"$?"; 1',
  '"$5"; 1',
  '"5 $"; 1',
  '"$ x"; 1',
  '"a `$x"; 1',
  '"a `"; Get-Date; "b"; 1',
  '"`n"; 1',
  '"`0"; 1',
  '"`u{1b}[2J"; 1',
  '"a\\b"; 1',
  '"@{a}"; 1',
  '"a@b"; 1',
  // ── where a string ends ──
  '"a\u201d; Get-Date; "b"; 1',
  '"a\u201c; Get-Date; \u201cb"; 1',
  '"a\u201e; Get-Date; "b"; 1',
  '\u201ca\u201d; 1',
  '\u201ca" + 1',
  '"a\u201f; 1"; 1',
  '"a\u2018b"; 1',
  '"a\u2019b"; 1',
  '"a\u201ab"; 1',
  '"a\u201bb"; 1',
  '"a\u2033b"; 1',
  '"a\uff02b"; 1',
  '"a\'b"; 1',
  "'a'; 1",
  "'a' + 1",
  "$x = 1; 'x = $x'",
  '"a""b"; 1',
  '"a""; Get-Date; ""b"; 1',
  '""a"; 1',
  '""""; 1',
  '"a" "b"; 1',
  '"a""b',
  '"a',
  '1; "a',
  'a"; 1',
  '"a\nb"; 1',
  '"a\r\nb"; 1',
  `"a${CR}b"; 1`,
  `"a${CR}; Get-Date; 1"`,
  `"a" # x${CR}Get-Date; 1`,
  `1; "a"${CR}Get-Date`,
  `"a" +${CR}1`,
  `$x = 1;${CR}"x = $x"`,
  `$x = 1; "x = $x"${CR}`.trimEnd() + `${CR}"b"`,
  '"a\u0000b"; 1',
  '"a\u0000"; 1',
  '1\u0000; "a"',
  '"a\u001b[2Jb"; 1',
  '"a\u0007b"; 1',
  '"a\u0008b"; 1',
  '"a\u007fb"; 1',
  '"a\u0085b"; 1',
  '"a\u009bb"; 1',
  '"a\u2028b"; 1',
  '"a\u2029b"; 1',
  '"a\tb"; 1',
  '"a\u000bb"; 1',
  '"a\u000cb"; 1',
  // Invisible or direction-changing: the approval-free text on screen must be what runs.
  '"a\u200bb"; 1',
  '"a\u202eb"; 1',
  '"a\u2066b"; 1',
  '"a\ufeffb"; 1',
  '\ufeff"a"; 1',
  '"a" + 1\ufeff',
  ' \ufeff"a" + 1',
  '\u00a0"a" + 1',
  '"a" + 1\u3000',
  '"a" + 1\r',
  '\r"a" + 1',
  '\u2028"a" + 1',
  '\u000b"a" + 1',
  '"a\u00a0b"; 1',
  '"a\u00a0"; 1',
  '"a"\u00a0+ 1',
  '"a"\u2003; 1',
  '"a\ud800b"; 1',
  '"a\u{1f4a9}b"; 1',
  '"a\uff21b"; 1',
  '"a > b"; 1',
  '"a < b"; 1',
  '"a | b"; 1',
  '"a & b"; 1',
  // ── what may stand next to a string ──
  '5"a"', // PowerShell runs a command named `5a`
  '5"a"; 1',
  '1.5"a"',
  '$x = 1; $x"a"',
  '(1)"a"',
  '"a"b; 1',
  '"a"5',
  '"a"$x; 1',
  '"a"(1)',
  '"a" (1)',
  '"a" 1',
  '"a" $x; 1',
  '"a": 5',
  '"a".Length; 1',
  '"a" .Length; 1',
  '"a".Insert(0, 1)',
  '"a"[0]',
  '"a" [0]',
  '"a"::x; 1',
  '"calc"#x\n1',
  '"a"|Out-File x; 1',
  '"a" | iex; 1',
  '"a" > x; 1',
  '"a" >> x; 1',
  '"a" 2>&1; 1',
  '& "calc"; 1',
  '&"calc"; 1',
  '. "x.ps1"; 1',
  '."x.ps1"; 1',
  '"a" && 1',
  '"a" || 1',
  '"a" ? 1 : 2',
  '"a" ?? 1',
  '"a", 1',
  '1, "a"',
  '"a","b"; 1',
  '@"\na\n"@; 1',
  '@"\n$(Get-Date)\n"@; 1',
  "@'\na\n'@; 1",
  '@("a"); 1',
  '@{"a"=1}',
  '"a" = 1',
  '"a" += 1',
  '"a"++; 1',
  '++"a"; 1',
  '"a"--; 1',
  'iex "1"',
  'Write-Output "a"; 1',
  'Write-Host "a"; 1',
  'echo "a"; 1',
  '[math]::Round("5")',
  '[math]::Pow("2", 3)',
  '[string]"a"; 1',
  '[int]"5"',
  '[char]5',
  '[scriptblock]::Create("1")',
  'if ("a") { 1 }',
  '{ "a" }; 1',
  'return "a"; 1',
  'throw "a"; 1',
  '%"a"; 1',
  // ── a string is never an operand of anything but + ──
  '"a" * 1000000000',
  '"a" * 3',
  '3 * "a"',
  '"a" % 2',
  '"a" / 2',
  '"a" - 2',
  '- "a"; 1',
  '-"a"; 1',
  '+ "a"; 1',
  '+"5"',
  '"a" + "b" * 1000000000',
  '"a" + 1 - 1',
  '"a" + "b" - 1',
  '("a") * 1000000000',
  '("a" + 1)',
  '("a"); 1',
  '("a"',
  '1 + "a"',
  '5 + "3"',
  '$x = 1; $x + "a"',
  '"a" + (1 + "b")',
  '"a" + [math]::Round("5")',
  '$s = "a"; 1',
  '$s = "a" + 1',
  '$s = "{0}" -f 1',
  '$x = 1; $x += "a"',
  '$x = 1; $x *= "a"',
  '"a" +',
  '"a" + ; 1',
  '"a" +\n1',
  '"a" + + ; 1',
  '"a" ++ 1',
  '"a" + $y; 1',
  // Two numbers in a row after a label: PowerShell joins their digits ("Tong = 35").
  '$a = 3; $b = 5; "Tong = " + $a + $b',
  '"Tong = " + 3 + 5',
  '"Tong = " + 3 + 5 + " tỷ"',
  // ── formats ──
  '"{0}" -f "a"; 1',
  '"{0}" -f 1, "a"',
  '"{0}" -f 5 * 1000000000', // -f binds tighter than *
  '"{0}" -f 5 + 3',
  '"{0}" -f 5 - 3',
  '"{0}" -f -5',
  '"{0}" -f +5',
  '"{0}" -f',
  '"{0}" -f\n1',
  '"{0}" -f ; 1',
  '"{0}" -f 1,',
  '"{0}" -f 1 2',
  '"{0}" -f (1,2)',
  '"{0}" -f @(1)',
  '"{0}" -f $(1)',
  '"{0}" -f $y; 1',
  '"{0}" -f 1; "{1}" -f 1',
  '"{1}" -f 1',
  '"{0}" -f 1, 2', // a value that is not printed
  '"a" -f 1',
  '"{10}" -f 1',
  '"{0,999999999}" -f 1',
  '"{0,5}" -f 1',
  '"{0,-5:N2}" -f 1',
  '"{0:F999999999}" -f 1',
  '"{0:F100}" -f 1',
  '"{0:X}" -f 1',
  '"{0:D9}" -f 1',
  '"{0:C}" -f 1',
  '"{0:R}" -f 1',
  '"{0:0.00}" -f 1',
  '"{0:yyyy}" -f 1',
  '"{0" -f 1',
  '"0}" -f 1',
  '"{{0}}" -f 1',
  '"{}" -f 1',
  '"{ 0}" -f 1',
  '"{0}{" -f 1',
  '$x = 1; "{0} $x" -f 1',
  '"{0} $(1)" -f 1',
  '"{0}" \u2013f 1', // PowerShell takes an en dash for -
  '"{0}" \u2014f 1',
  '"{0}" \u2015f 1',
  '"{0}" \u2212f 1',
  '"{0}" -\uff46 1',
  '"a" \u2013 1',
  '"{0}" - f 1',
  '"{0}" -ff 1',
  '"{0}" -f1',
  '"{0}" -f.5',
  '"{0}" -f:1',
  '"{0}" -f[math]::Abs(1)',
  '"{0}" -foo 1',
  '"{0}" -fé 1',
  '"a" -replace 1',
  '"a" -join 1',
  '"a" -split 1',
  '"a" -eq 1',
  '"a" -as 1',
  '"a" -is [int]',
  '"a" -match 1',
  '5 -f 1',
  '$x = 1; $x -f 1',
  '("{0}") -f 1',
  '("{0}" -f 1) * 1000000000',
  '"{0}" -f 1 -f 2',
  '"{0}" + "{1}" -f 1, 2',
  '"{0}" -f 1 + " %"',
  '$f = "{0}"; $f -f 1',
  // Braces and square brackets only in a format: "[math]::Round($x,3)" would print itself.
  '$x = 1; "[math]::Round($x,3)"',
  '"{0:N2}" + 1',
  // Text alone computes nothing: a figure could be put in the output with no calculation behind it.
  '"hello"',
  '"ROE = 25.7"',
  '"a"; "b" + "c"',
  // Limits.
  `"${"a".repeat(8001)}" + 1`,
  Array.from({ length: 61 }, () => '"a" + 1').join(";"),
]

test("PowerShell labels: everything else stays refused", () => {
  for (const c of HOSTILE) expect(mathOnlyCommand(c, PS), JSON.stringify(c)).toBe(false)
})

test("every Unicode code point that is not plain label text is refused in a label, as any quote or dash is outside one", () => {
  // Letters with Vietnamese marks and a few signs; everything else PowerShell might give a meaning to is out.
  const allowed = /^[ %()*+,\-./0-9:;=?A-Z^_a-zÀ-ɏ\u0300-\u036fḀ-ỿ\u20ab\u00b0\u00b1\u00d7\u00f7\u2248]$/
  for (let cp = 0; cp < 0x10000; cp++) {
    const ch = String.fromCharCode(cp)
    if (ch === '"') continue // ends the string: covered above
    const inside = mathOnlyCommand(`"a${ch}b" + 1`, PS)
    if (inside !== allowed.test(ch)) throw new Error(`U+${cp.toString(16)} in a label: ${inside}`)
    // Glued after a variable's name: only characters PowerShell ends a name at, and never a scope or an index.
    const after = mathOnlyCommand(`$x = 1; "$x${ch} b"`, PS)
    if (after !== /^[ %),\-./;=*+^]$/.test(ch)) throw new Error(`U+${cp.toString(16)} after $x: ${after}`)
    // Outside strings nothing beyond ASCII (and whitespace as before) was ever a token.
    if (cp > 0x7f && mathOnlyCommand(`"a"${ch}+ 1`, PS)) throw new Error(`U+${cp.toString(16)} outside a string`)
  }
})

test("awk and POSIX are unchanged: no label beyond print, no -f, no $name", () => {
  for (const c of [
    `"a" + 1`,
    `awk 'BEGIN{x = 1; "x = " x}'`,
    `awk 'BEGIN{x = 1; print "x = " + x}'`,
    `awk 'BEGIN{"a" + 1}'`,
    `awk 'BEGIN{print "{0}" -f 1}'`,
    `awk 'BEGIN{x = "a" + 1; print x}'`,
    `echo "a" + 1`,
  ]) expect(mathOnlyCommand(c, BASH), c).toBe(false)
  for (const c of [`awk 'BEGIN{x = 1; print "x $x [a] #", x}'`, `awk 'BEGIN{print "only text"}'`]) expect(mathOnlyCommand(c, BASH), c).toBe(true)
})

test("a long hostile label is judged at once: no pattern backtracks", () => {
  const started = performance.now()
  for (const body of ["$abcdefgh ".repeat(700), "$abcdefgh".repeat(700), "a".repeat(7000), "{0:N2}".repeat(1000), "{0} ".repeat(1500), "$(".repeat(3000), "$(1)".repeat(1500), "()".repeat(3000), "a.".repeat(3000), "\u0300".repeat(7000)])
    for (const tail of ["", "@", "\u201d", "$", "{"])
      for (const c of [`"${body}${tail}" + 1+1`, `$abcdefgh = 1; "${body}${tail}"`, `"${body}${tail}" -f 1*1`, `'${body}${tail}' + 1`, `1+1; "${body}${tail}`]) {
        mathOnlyCommand(c, PS)
        computeIntent(c, PS)
      }
  expect(performance.now() - started).toBeLessThan(3_000)
})

// ── PowerShell's own parser ────────────────────────────────────────────────

/** Prints the index and reason of each command (base64 UTF-16, one a line) that is more than arithmetic with labels to PowerShell. */
const CHECKER = String.raw`
param($File)
$lines = [IO.File]::ReadAllLines($File)
$allowed = 'ScriptBlockAst NamedBlockAst PipelineAst CommandExpressionAst AssignmentStatementAst BinaryExpressionAst UnaryExpressionAst ParenExpressionAst ConstantExpressionAst StringConstantExpressionAst ExpandableStringExpressionAst VariableExpressionAst InvokeMemberExpressionAst TypeExpressionAst ArrayLiteralAst'.Split(' ')
# Not a member's name (Round in [math]::Round): that one is a bare word.
function IsText($n) { ($n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.StringConstantType -ne 'BareWord') -or ($n -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) }
for ($i = 0; $i -lt $lines.Count; $i++) {
  $code = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($lines[$i]))
  $bad = @()
  # As it runs: inside the braces of run.ts.
  $t = $null; $e = $null
  $outer = [System.Management.Automation.Language.Parser]::ParseInput("& {" + [char]10 + $code + [char]10 + "} 2>&1", [ref]$t, [ref]$e)
  if ($e.Count) { $bad += 'error ' + $e[0].ErrorId }
  if ($outer.EndBlock.Statements.Count -ne 1 -or $outer.EndBlock.Statements[0].PipelineElements.Count -ne 1) { $bad += 'left the braces' }
  $t = $null; $e = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$t, [ref]$e)
  if ($e.Count) { $bad += 'error ' + $e[0].ErrorId }
  foreach ($n in $ast.FindAll({ $true }, $true)) {
    $type = $n.GetType().Name
    if ($allowed -notcontains $type) { $bad += $type; continue }
    if ($type -eq 'PipelineAst' -and $n.PipelineElements.Count -ne 1) { $bad += 'pipe' }
    if ($type -eq 'CommandExpressionAst' -and $n.Redirections.Count) { $bad += 'redirect' }
    if ($type -eq 'VariableExpressionAst') {
      if ($n.Splatted -or -not $n.VariablePath.IsUnqualified -or $n.VariablePath.UserPath -cnotmatch '^[A-Za-z_][A-Za-z0-9_]*$') { $bad += 'variable ' + $n.VariablePath.UserPath }
    }
    if ($type -eq 'TypeExpressionAst' -and $n.TypeName.FullName -ne 'math') { $bad += 'type' }
    if ($type -eq 'InvokeMemberExpressionAst') {
      if (-not $n.Static -or $n.Expression.GetType().Name -ne 'TypeExpressionAst') { $bad += 'member' }
      if ($n.FindAll({ IsText $args[0] }, $true).Count) { $bad += 'text in a call' }
    }
    if ($type -eq 'AssignmentStatementAst' -and $n.Right.FindAll({ IsText $args[0] }, $true).Count) { $bad += 'text in a variable' }
    if ($type -eq 'ArrayLiteralAst' -and -not ($n.Parent -is [System.Management.Automation.Language.BinaryExpressionAst] -and $n.Parent.Operator -eq 'Format')) { $bad += 'array' }
    if ($type -eq 'BinaryExpressionAst') {
      $op = [string]$n.Operator
      if ('Plus Minus Multiply Divide Rem Format'.Split(' ') -notcontains $op) { $bad += $op }
      if ($op -eq 'Format' -and -not ($n.Left -is [System.Management.Automation.Language.StringConstantExpressionAst])) { $bad += 'format not literal' }
      if ('Minus Multiply Divide Rem'.Split(' ') -contains $op) {
        if ($n.FindAll({ IsText $args[0] }, $true).Count) { $bad += 'text under ' + $op }
      }
      if ($op -eq 'Plus' -and (IsText $n.Right)) {
        # The left side must be text already: its leftmost operand is.
        $l = $n.Left; while ($l -is [System.Management.Automation.Language.BinaryExpressionAst] -and $l.Operator -eq 'Plus') { $l = $l.Left }
        if (-not (IsText $l)) { $bad += 'number + text' }
      }
    }
  }
  if ($bad.Count) { [string]$i + ' ' + ($bad -join ', ') }
}
`

async function violations(engine: string, commands: string[]): Promise<string[]> {
  const file = path.join(root, "commands.txt")
  const script = path.join(root, "check.ps1")
  writeFileSync(file, commands.map((c) => Buffer.from(c, "utf16le").toString("base64")).join("\n"))
  writeFileSync(script, CHECKER)
  const proc = Bun.spawn([engine, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, file], { stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (err.trim()) throw new Error(err)
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `${line.replace(/^\d+ /, "")}: ${JSON.stringify(commands[Number(line.split(" ")[0])])}`)
}

/** A seeded generator (mulberry32): the same commands on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SCRAPS = [
  '"', '"', '"a"', '"a = $x"', '" + "', "$x", "$y", "$", "$(", "${", "$env:", "`", "'", "@", "\u201c", "\u201d", "\u201e", "\u2018", "\u2013", "\u2014", "-f", " -f ", "{0}", "{0:N2}", "{1}", "{", "}", "(", ")", "[", "]", "[math]::Round(", "[math]::", "::", ":", ".", ",", ";", "\n", "\r", "\r\n", "\u0000", "\u0085", "\u2028", "\u00a0", " ", "  ", "\t", "+", "-", "*", "/", "%", "=", "+=", "#", "# c", "?", "|", "&", ">", "1", "2.5", "1e3", "x", "é", "\u0300", "$x = 1;", "$x=2\n", "$y = $x;", "1; ", "Get-Date", "iex",
]

/** Accepted commands mutated (a scrap inserted, replaced or removed), and scraps strung together. */
function fuzz(seed: number, count: number): string[] {
  const next = random(seed)
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!
  const seeds = OK.map(([c]) => c)
  const accepted = new Set<string>()
  for (let n = 0; n < count; n++) {
    let c = next() < 0.8 ? pick(seeds) : ""
    for (let edits = 1 + Math.floor(next() * (c ? 4 : 10)); edits > 0; edits--) {
      const at = Math.floor(next() * (c.length + 1))
      const cut = next() < 0.5 ? Math.floor(next() * 6) : 0
      c = c.slice(0, at) + (next() < 0.85 ? pick(SCRAPS) : "") + c.slice(at + cut)
    }
    if (mathOnlyCommand(c, PS)) accepted.add(c)
  }
  return [...accepted]
}

test.each([...ENGINES])("the parser of %s sees only arithmetic and labels in what the grammar accepts", async (_, engine) => {
  // The checker itself: it must see through what the grammar refuses.
  const caught = ['"$(1)"', '"a\u201d; Get-Date; "b"', '5"a"', '"$env:PATH"', '"a".Length', '"a" * 3', '"{0}" -f 5 * 3', '$s = "a"', '1 > x', '"a" | iex', '1 + "a"', "[math]::Round('5')", '$x = 1; "$x: b"', "1 }; { 2", '"$ròng"']
  expect((await violations(engine, caught)).length).toBe(caught.length)
  const accepted = [...OK.map(([c]) => c), ...fuzz(Number(process.env.OT_FUZZ_SEED ?? 268), Number(process.env.OT_FUZZ ?? 6_000))]
  if (process.env.OT_FUZZ) console.log("accepted", accepted.length)
  expect(accepted.length).toBeGreaterThan(200)
  expect(await violations(engine, accepted)).toEqual([])
}, 600_000)

// ── running ────────────────────────────────────────────────────────────────

test.each([...ENGINES])("%s prints labels in the invariant culture, also when the user's is vi-VN", async (kind, engine) => {
  const commands = OK.map(([c]) => c)
  const outs: string[] = []
  for (let i = 0; i < commands.length; i += 4)
    outs.push(
      ...(await Promise.all(
        commands.slice(i, i + 4).map(async (command) => {
          const args = shellArgs({ kind, path: engine }, command)
          const script = `[System.Threading.Thread]::CurrentThread.CurrentCulture='vi-VN'\n${Buffer.from(args.at(-1)!, "base64").toString("utf16le")}`
          const proc = Bun.spawn([...args.slice(0, -1), Buffer.from(script, "utf16le").toString("base64")], { stdout: "pipe", stderr: "pipe" })
          const out = await new Response(proc.stdout).text()
          expect(await proc.exited, `${command}\n${out}`).toBe(0)
          return out
        }),
      )),
    )
  OK.forEach(([command, expected], i) => expect(outs[i], command).toContain(expected))
}, 60_000)

// ── the hint ───────────────────────────────────────────────────────────────

/** The refused commands of the 25/11 measurement (issue #268), shortened, and the reason each one gets. */
const REFUSED: [string, string, string][] = [
  ["series", "arrays or loops", "$hp=@(21.55,21.1,21.15)\n$rx=@();for($i=1;$i-le2;$i++){$rx+=$hp[$i]/$hp[$i-1]-1}\n$mx=($rx|Measure-Object -Average).Average;[math]::Round($mx,4)"],
  [
    "series",
    "arrays or loops",
    '$prices = @(20.05, 20.5, 20.35)\n$dates = @("10-01","10-02","10-05")\n$peak = 0; $peakDate = ""; $maxDD = 0\nfor ($i = 0; $i -lt $prices.Count; $i++) {\n    $p = $prices[$i]\n    if ($p -gt $peak) { $peak = $p; $peakDate = $dates[$i] }\n}\n"Trough: $($prices[[array]::IndexOf($dates,$peakDate)])"\n"Max drawdown: $([math]::Round($maxDD,4))% -> 2 decimals"',
  ],
  ["series", "arrays or loops", '$vols = @(12000000,13419003); $n=$vols.Count; $sum=0; foreach($v in $vols){$sum+=$v}; "n=$n"; "pct=$([math]::Round($sum/$n,2))"'],
  ["series", "arrays or loops", '$p = 48.5,50.2,51.8; $m=0; for ($i=0; $i -lt $p.Length; $i++) { $m=$p[$i] }; "Phien=" + $m'],
  ["series", "arrays or loops", "$p = 48.5, 50.2, 51.8; $p[0] + $p[1]"],
  ["write", "Write-Output", '$steel=(2015.3-1842.6)/1842.6*100; Write-Output ("steel pct change={0:F6}" -f $steel)'],
  ["brackets", "brackets do not match", "$f=(51.8-45.2)/51.8*100; $g=(51.8-44.7)/51.8*100; [math]::Max($f,[math]::Max($g,$f)]; [math]::Round($g,3)"],
  ["brackets", "brackets do not match", "$f=(51.8-45.2/51.8*100; $f"],
  ["subexpression", "$(…)", '$E=12400; $V=$E+7850; "V=$V"; "E/V=$([math]::Round($E/$V,6))"'],
  ["joined", "in brackets", '$a = 3; $b = 5; "Tong = " + $a + $b'],
  ["unassigned", "before any statement assigned it", '$a = 3*2; "Tong = $tong"'],
  ["unassigned", "before any statement assigned it", "$x = 5; $y*2"],
  ["label", "label", '$x = 3/2; "x={0:0.00}" -f $x'],
  ["label", "label", "$x = 3/2; 'x = ' + $x"],
  ["label", "label", '$x = 3/2; "[math]::Round($x,3)"'],
  ["label", "label", '$x = 3/2; $s = "x = " + $x; $s'],
  ["form", "", "1,2*3"],
]

test("the hint names what was refused: no 'arrays or loops' for a command that has none", () => {
  const tool = shellTool(ws(), { shell: PS_SHELL })
  for (const [miss, says, command] of REFUSED) {
    expect([command, computeIntent(command, PS)]).toEqual([command, miss as never])
    const hint = tool.rewrite!({ command })!
    if (says) expect(hint, command).toContain(says)
    if (miss !== "series") expect(hint, command).not.toContain("uses arrays or loops")
  }
  // The description shows the label forms, so the model writes them the first time.
  expect(tool.description).toContain('"g = $g"')
})

test("a command that does more than compute still goes to the user, whatever its strings hold", () => {
  for (const c of [
    '"$(Get-Content a.txt)"; 1+1',
    '"$(Remove-Item x) 1"; 2*3',
    '"$env:PATH"; 1+1',
    '$x = 1 + 1; "${env:USERNAME}"',
    '"a" | Out-File x; 1+1',
    '& "calc.exe"; 1+1',
    'Start-Process "calc"; 1+1',
    'Write-Output "xong"',
    '"hello"',
    "$x = 1 + 1; [IO.File]::WriteAllText('a', 'b')",
    "$x = 1 + 1; [array]::Reverse($x)",
    '"a\u201d; Remove-Item x; \u201c" + (1+1)',
    '"`$(1+1)"; 1+1',
  ]) expect([c, computeIntent(c, PS)]).toEqual([c, undefined])
})
