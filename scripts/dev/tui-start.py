"""Start a command in a real pseudo-terminal and check that the TUI draws (macOS, Linux).

Cach chay: python3 scripts/dev/tui-start.py ~/.opentrading/bin/ot

Passes when the process is still running after it drew OpenTrading's name in the alternate screen;
a crash, an exit or an empty screen within the time limit fails. No key is needed.
"""

import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

LIMIT = 30
pid, fd = pty.fork()
if pid == 0:
    os.environ.update(TERM="xterm-256color", COLORTERM="truecolor", OPENTRADING_DISABLE_UPDATE_CHECK="1")
    os.execvp(sys.argv[1], sys.argv[1:])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

out = b""
drawn = False
end = time.time() + LIMIT
while time.time() < end and not drawn:
    if not select.select([fd], [], [], 0.5)[0]:
        continue
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
    # Text without escape sequences: the name may be drawn cell by cell with colours between.
    text = re.sub(rb"\x1b(\[[0-?]*[ -/]*[@-~]|[\]P_].*?(\x07|\x1b\\)|[=>()][A-Z0-9]?)", b"", out, flags=re.S)
    drawn = b"\x1b[?1049h" in out and (b"OpenTrading" in text or b"opentrading" in text)

time.sleep(2)
alive = os.waitpid(pid, os.WNOHANG) == (0, 0)
if alive:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
print(f"drawn={drawn} alive={alive} bytes={len(out)}")
if not (drawn and alive):
    sys.stdout.flush()
    sys.stdout.buffer.write(out[-3000:])
    sys.exit(1)
