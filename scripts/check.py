#!/usr/bin/env python3
"""Run the milestone verification checks in one place.

Usage:
    uv run --project backend python scripts/check.py

This intentionally reports failures instead of stopping at the first one. It
regenerates the frontend types and fails if the committed file was stale.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = REPOSITORY_ROOT / "apps" / "web"
BACKEND_ROOT = REPOSITORY_ROOT / "backend"
GENERATED_TYPES = WEB_ROOT / "src" / "generated" / "newsTraceContracts.ts"


def run(label: str, command: list[str], cwd: Path = REPOSITORY_ROOT) -> bool:
    print(f"\n== {label} ==")
    print("$ " + " ".join(command))
    completed = subprocess.run(command, cwd=cwd, check=False)
    if completed.returncode != 0:
        print(f"FAILED: {label} (exit {completed.returncode})")
        return False
    print(f"PASSED: {label}")
    return True


def main() -> int:
    npm = shutil.which("npm")
    if npm is None:
        print("npm was not found on PATH", file=sys.stderr)
        return 1

    results: list[tuple[str, bool]] = []

    results.append(
        (
            "shared schema freshness",
            run(
                "shared schema freshness",
                [sys.executable, "scripts/generate_contracts.py", "--check"],
            ),
        )
    )

    before = GENERATED_TYPES.read_bytes() if GENERATED_TYPES.exists() else b""
    types_generated = run(
        "frontend type generation",
        [npm, "--prefix", "apps/web", "run", "generate:types"],
    )
    after = GENERATED_TYPES.read_bytes() if GENERATED_TYPES.exists() else b""
    types_current = types_generated and before == after
    if types_generated and not types_current:
        print(
            "\nFAILED: generated frontend types were stale; commit the regenerated file",
            file=sys.stderr,
        )
    results.append(("generated frontend types current", types_current))

    results.append(
        (
            "backend tests",
            run(
                "backend tests",
                [sys.executable, "-m", "pytest", "-q"],
                cwd=BACKEND_ROOT,
            ),
        )
    )
    results.append(
        (
            "frontend tests",
            run("frontend tests", [npm, "--prefix", "apps/web", "test"]),
        )
    )
    results.append(
        (
            "frontend typecheck",
            run("frontend typecheck", [npm, "--prefix", "apps/web", "run", "typecheck"]),
        )
    )
    results.append(
        (
            "frontend production build",
            run("frontend production build", [npm, "--prefix", "apps/web", "run", "build"]),
        )
    )

    print("\n== Summary ==")
    for label, passed in results:
        print(f"{'PASS' if passed else 'FAIL'}  {label}")
    return 0 if all(passed for _, passed in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
