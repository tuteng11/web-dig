from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from news_trace.fixtures import FixtureDocument

from helpers import FIXTURE_PATH, REPOSITORY_ROOT

WEB_TYPES = REPOSITORY_ROOT / "apps" / "web" / "src" / "generated" / "newsTraceContracts.ts"


def test_generated_json_schema_is_current() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/generate_contracts.py", "--check"],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_fixture_document_is_schema_valid_and_complete() -> None:
    document = FixtureDocument.from_path(FIXTURE_PATH)

    assert document.research_id == "fixture-riverbend"
    assert document.seed_node_id == "n-seed"
    assert len(document.nodes) >= 12
    assert {node.content_kind.value for node in document.nodes} == {"post", "news", "webpage"}
    assert {"initial", "expanded"} <= set(document.stages)
    assert len(document.stages["expanded"].node_ids) == len(document.stages["initial"].node_ids) + 1


def test_generated_frontend_types_contain_shared_contracts() -> None:
    source = WEB_TYPES.read_text(encoding="utf-8")

    for name in ("GraphResult", "SourceNode", "NodeDetails", "Relationship", "OriginAssessment"):
        assert f"export interface {name}" in source
    assert "Generated from contracts/generated/news_graph.schema.json" in source
    assert "do not edit" in source.lower()
