"""Typed request contracts for gateway job and graph-mutation routes.

The new frontend already calls these routes, but this milestone only implements
synthetic read-only research. The models below mirror the request shapes in
``frontend/src/contracts/http.ts`` so invalid requests are rejected with the
gateway's safe error envelope before the explicit "not implemented" stub runs.

They are deliberately separate from ``SharedContractBundle``: no job or mutation
response contract exists yet, so nothing here belongs in the generated schema.
"""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

STRICT = ConfigDict(extra="forbid")

BoundedId = Annotated[str, Field(min_length=1, max_length=200)]
Revision = Annotated[int, Field(ge=1, strict=True)]


def validate_http_url(value: str) -> str:
    """Validate an absolute http(s) URL with a bounded length and no userinfo.

    This mirrors the private validator in ``news_trace.models`` but lives here so
    request contracts can use a public helper without importing private names.
    """

    if len(value) > 2048:
        raise ValueError("URL must be at most 2048 characters")
    if any(character.isspace() for character in value):
        raise ValueError("URL must not contain whitespace")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("URL must be an absolute http(s) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URL must not contain userinfo")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("URL must contain a valid port") from exc
    return value


class StartResearchRequest(BaseModel):
    model_config = STRICT

    question: str = Field(min_length=1, max_length=2000)
    source_url: str
    request_id: UUID

    @field_validator("question")
    @classmethod
    def _question_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question must not be blank")
        return value

    @field_validator("source_url")
    @classmethod
    def _source_url_must_be_valid(cls, value: str) -> str:
        return validate_http_url(value)


class ExpandNodeRequest(BaseModel):
    model_config = STRICT

    node_id: BoundedId
    graph_revision: Revision
    request_id: UUID


class AskQuestionRequest(BaseModel):
    model_config = STRICT

    node_ids: list[BoundedId] = Field(min_length=2, max_length=2)
    graph_revision: Revision
    question: str = Field(min_length=1, max_length=2000)
    request_id: UUID

    @field_validator("node_ids")
    @classmethod
    def _node_ids_must_be_distinct(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("node_ids must be distinct")
        return value

    @field_validator("question")
    @classmethod
    def _question_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question must not be blank")
        return value


class AddDiscoveriesRequest(BaseModel):
    model_config = STRICT

    answer_id: BoundedId
    candidate_ids: list[BoundedId] = Field(min_length=1)
    graph_revision: Revision
    request_id: UUID

    @field_validator("candidate_ids")
    @classmethod
    def _candidate_ids_must_be_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("candidate_ids must be unique")
        return value
