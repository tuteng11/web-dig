#!/usr/bin/env python3
"""Generate the committed shared JSON Schema from Pydantic models.

Usage:
    python scripts/generate_contracts.py
    python scripts/generate_contracts.py --check

The TypeScript types are generated from this schema by:
    npm --prefix apps/web run generate:types
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "backend" / "src"))

from news_trace.models import SharedContractBundle  # noqa: E402

OUTPUT_PATH = REPOSITORY_ROOT / "contracts" / "generated" / "news_graph.schema.json"


def _strip_titles(value: object) -> object:
    """Remove Pydantic's per-field annotations so json-schema-to-typescript emits
    inline primitives instead of hundreds of single-use aliases.

    Only schema ``title`` annotations are removed. Keys inside ``properties`` are
    field names and must be preserved (for example ``SourceNode.title``).
    """
    if isinstance(value, dict):
        stripped: dict[str, object] = {}
        for key, item in value.items():
            if key == "title":
                continue
            if key == "properties" and isinstance(item, dict):
                stripped[key] = {
                    property_name: _strip_titles(property_schema)
                    for property_name, property_schema in item.items()
                }
            else:
                stripped[key] = _strip_titles(item)
        return stripped
    if isinstance(value, list):
        return [_strip_titles(item) for item in value]
    return value


def render_schema() -> str:
    schema = SharedContractBundle.model_json_schema()
    document = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://news-trace.local/contracts/news_graph.schema.json",
        "title": "NewsTraceContracts",
        **_strip_titles(schema),
    }
    return json.dumps(document, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the committed schema differs from the generated schema",
    )
    args = parser.parse_args()

    rendered = render_schema()
    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"missing generated schema: {OUTPUT_PATH}", file=sys.stderr)
            return 1
        if OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            print(
                "generated schema is stale; run python scripts/generate_contracts.py",
                file=sys.stderr,
            )
            return 1
        print(f"schema is up to date: {OUTPUT_PATH}")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
