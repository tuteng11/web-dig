"""Stage two self-contained Databricks source trees without copying credentials."""

from __future__ import annotations

import argparse
import shutil
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New directory for the two deployable source trees")
    output = parser.parse_args().output.resolve()
    if output.exists():
        parser.error(f"Output directory already exists: {output}")

    backend = ROOT / "backend"
    deployment = ROOT / "deploy/databricks"
    with (backend / "pyproject.toml").open("rb") as file:
        dependencies = tomllib.load(file)["project"]["dependencies"]
    requirements = "\n".join(dependencies) + "\n" + (deployment / "requirements.txt").read_text()
    output.mkdir(parents=True)
    for role in ("web", "research"):
        target = output / role
        shutil.copytree(
            backend / "src/news_trace/databricks", target / "news_trace/databricks",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        shutil.copyfile(backend / "src/news_trace/__init__.py", target / "news_trace/__init__.py")
        shutil.copyfile(deployment / role / "app.yaml", target / "app.yaml")
        (target / "requirements.txt").write_text(requirements, encoding="utf-8")
        print(target)


if __name__ == "__main__":
    main()
