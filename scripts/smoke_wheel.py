"""Install the built wheel in a clean environment and exercise public commands."""

import os
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from opentrading import __version__

ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str], *, environment: dict[str, str] | None = None) -> None:
    subprocess.run(command, check=True, cwd=ROOT, env=environment)


def main() -> int:
    wheels = sorted((ROOT / "dist").glob(f"opentrading-{__version__}-*.whl"))
    if len(wheels) != 1:
        print(f"Expected exactly one wheel, found {len(wheels)}.")
        return 1
    with TemporaryDirectory(prefix="opentrading-wheel-smoke-") as temporary:
        environment_path = Path(temporary) / ".venv"
        run([sys.executable, "-m", "venv", str(environment_path)])
        scripts = environment_path / ("Scripts" if os.name == "nt" else "bin")
        python = scripts / ("python.exe" if os.name == "nt" else "python")
        executable = scripts / ("opentrading.exe" if os.name == "nt" else "opentrading")
        run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--quiet",
                str(wheels[0]),
            ]
        )
        clean_environment = os.environ.copy()
        clean_environment.pop("OPENTRADING_DONGANH_CAPITAL_BASE_URL", None)
        clean_environment.pop("OPENTRADING_TRADING_AGENTS_BASE_URL", None)
        run([str(executable), "--version"], environment=clean_environment)
        run([str(executable), "doctor"], environment=clean_environment)
    print("Wheel smoke test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
