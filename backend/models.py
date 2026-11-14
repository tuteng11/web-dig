from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

Stance = Literal["Supports", "Adds context", "Contradicts", "Repeats claim", "Unclear"]
Verdict = Literal["Supported", "Partially Supported", "Overstated", "Contradicted", "Insufficient Evidence"]
SourceType = Literal["Primary evidence", "Press release", "Reporting", "Fact check", "Other"]


class TraceRequest(BaseModel):
    claim: str = Field(default="", max_length=1000)
    mode: Literal["live", "demo"] = "live"


class Source(BaseModel):
    id: str
    title: str
    publisher: str
    domain: str
    url: HttpUrl
    published: date | None = None
    retrieved_at: datetime | None = None
    date_basis: str | None = None
    kind: SourceType = "Other"
    excerpt: str
    excerpt_type: Literal["Extracted passage", "Verified quotation"] = "Extracted passage"
    stance: Stance = "Unclear"
    interpretation: str = ""
    wording: str = ""


class Relationship(BaseModel):
    source: str
    target: str
    proof: str


class TraceResult(BaseModel):
    mode: Literal["demo", "live"]
    claim: str
    input_url: HttpUrl | None = None
    verdict: Verdict
    summary: str
    citations: list[str] = Field(default_factory=list)
    earliest_id: str | None = None
    original_id: str | None = None
    sources: list[Source] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    retrieval: str
    stored_sources: int = 0
    stored_passages: int = 0
    evidence_cutoff: date | None = None
    trace_id: str | None = None


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    demo_available: bool = True
    live_configured: bool
    ai_search_configured: bool
    missing: list[str]
