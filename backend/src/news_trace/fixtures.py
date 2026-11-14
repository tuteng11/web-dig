"""Load and validate the deterministic synthetic research fixture."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from news_trace.models import Evidence, Relationship, SourceNode


class FixtureStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graph_revision: int = Field(ge=1)
    node_ids: list[str]
    origin_eligible_node_ids: list[str]

    @model_validator(mode="after")
    def _check_stage(self) -> FixtureStage:
        if len(set(self.node_ids)) != len(self.node_ids):
            raise ValueError("stage node_ids must be unique")
        if not set(self.origin_eligible_node_ids) <= set(self.node_ids):
            raise ValueError("origin eligible nodes must belong to the stage")
        if len(set(self.origin_eligible_node_ids)) != len(self.origin_eligible_node_ids):
            raise ValueError("origin eligible node ids must be unique")
        return self


class FixtureDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    research_id: str
    label: str
    seed_node_id: str
    searched_at: AwareDatetime
    stages: dict[str, FixtureStage]
    nodes: list[SourceNode]
    evidence: list[Evidence]
    relationships: list[Relationship]
    coverage_notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_document(self) -> FixtureDocument:
        if "initial" not in self.stages:
            raise ValueError("fixture requires an initial stage")
        node_ids = [node.id for node in self.nodes]
        if len(set(node_ids)) != len(node_ids):
            raise ValueError("fixture node ids must be unique")
        node_id_set = set(node_ids)
        if any(node.research_id != self.research_id for node in self.nodes):
            raise ValueError("every fixture node must match the fixture research id")
        if self.seed_node_id not in node_id_set:
            raise ValueError("seed_node_id must reference a fixture node")

        evidence_ids = [item.id for item in self.evidence]
        if len(set(evidence_ids)) != len(evidence_ids):
            raise ValueError("fixture evidence ids must be unique")
        for item in self.evidence:
            if item.node_id not in node_id_set:
                raise ValueError("evidence must reference a fixture node")
        evidence_id_set = set(evidence_ids)
        for node in self.nodes:
            publication_evidence = node.publication.evidence_id
            if publication_evidence is not None:
                if publication_evidence not in evidence_id_set:
                    raise ValueError(
                        f"node {node.id!r} publication evidence is missing from the fixture"
                    )
                if next(
                    item for item in self.evidence if item.id == publication_evidence
                ).node_id != node.id:
                    raise ValueError(
                        f"node {node.id!r} publication evidence belongs to another node"
                    )

        relationship_ids = [item.id for item in self.relationships]
        if len(set(relationship_ids)) != len(relationship_ids):
            raise ValueError("fixture relationship ids must be unique")
        for item in self.relationships:
            if item.from_node_id not in node_id_set or item.to_node_id not in node_id_set:
                raise ValueError("relationship endpoints must reference fixture nodes")
            if not set(item.evidence_ids) <= evidence_id_set:
                raise ValueError("relationship evidence ids must reference fixture evidence")

        for name, stage in self.stages.items():
            if not set(stage.node_ids) <= node_id_set:
                raise ValueError(f"stage {name!r} references unknown nodes")
            if self.seed_node_id not in stage.node_ids:
                raise ValueError(f"stage {name!r} must contain the seed node")
        return self

    @classmethod
    def from_path(cls, path: Path) -> FixtureDocument:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return cls.model_validate(payload)
