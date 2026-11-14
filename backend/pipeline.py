import json
import logging
import math
import re
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit
from uuid import uuid4

import httpx
from pydantic import BaseModel, Field

from .models import Relationship, Source, SourceType, Stance, TraceResult, Verdict
from .providers import Document, Providers, canonical_url, split_passages
from .settings import Settings
from .store import DeltaStore, Passage

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT = """You are an evidence analyst. Return a JSON object with keys verdict, summary,
citations, original_id, and sources. Use only the supplied claim, title, source metadata and
passages. Assign verdict exactly one of Supported, Partially Supported, Overstated, Contradicted,
Insufficient Evidence. Repetition of a claim does not establish it. Summary must be at most 90
words. Citations is a list of supplied source IDs supporting the summary; use an empty list if
evidence was insufficient and no specific source is discussed. Set original_id to a supplied ID
only if its own evidence is directly relevant and it is identifiable as original empirical
evidence or the official statement underlying the claim. Otherwise use null. Sources is an array
of objects with id, relevant (boolean), kind (Primary evidence, Press release, Reporting, Fact check,
or Other), stance (Supports, Adds context, Contradicts, Repeats claim, or Unclear), interpretation
(one or two short sentences about what the passage establishes), and wording (a short paraphrase
of how the passage frames the claim). Mark tangential sources irrelevant. Use the evidence
available, preserve uncertainty, and never invent quotations, publication dates, URLs or links.
Return no markdown."""


class AssessmentSource(BaseModel):
    id: str
    relevant: bool
    kind: SourceType
    stance: Stance
    interpretation: str = Field(max_length=600)
    wording: str = Field(max_length=260)


class Assessment(BaseModel):
    verdict: Verdict
    summary: str = Field(min_length=1, max_length=850)
    citations: list[str]
    original_id: str | None
    sources: list[AssessmentSource]


def cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left or not (denominator := math.hypot(*left) * math.hypot(*right)):
        return 0
    return sum(a * b for a, b in zip(left, right)) / denominator


def rank_passages(candidates: list[Passage], query: list[float], ai_ids: list[str]) -> dict[str, Passage]:
    indexed = {passage_id: score for score, passage_id in enumerate(ai_ids)}
    # Use AI Search order for indexed hits, then cosine over fresh and historical Delta rows.
    scored = [(cosine(query, passage.embedding), passage) for passage in candidates]
    ranked = sorted(
        scored,
        key=lambda item: (item[1].id not in indexed, indexed.get(item[1].id, 0), -item[0]),
    )
    best = {}
    for score, passage in ranked:
        if score >= 0.27:
            best.setdefault(passage.source_id, passage)
    return best


def ai_search(client: httpx.Client, settings: Settings, claim: str) -> list[str]:
    index = quote(settings.index, safe="")
    response = client.post(
        f"https://{settings.db_host}/api/2.0/vector-search/indexes/{index}/query",
        json={"query_text": claim, "num_results": 30, "columns": ["id"]},
        headers={"Authorization": f"Bearer {settings.db_token}"},
        timeout=12,
    )
    response.raise_for_status()
    return [row[0] for row in response.json().get("result", {}).get("data_array", []) if row]


def empty_result(claim, input_url, warnings, retrieval, counts=(0, 0)):
    return TraceResult(
        mode="live", claim=claim, input_url=input_url, verdict="Insufficient Evidence",
        summary="The retrieved material did not provide enough relevant evidence to assess this claim.",
        warnings=warnings, retrieval=retrieval, stored_sources=counts[0], stored_passages=counts[1],
    )


def collect(providers: Providers, value: str):
    warnings = []
    input_url = None
    original = None
    claim = value
    if re.match(r"^www\.[^\s]+$", value, re.I):
        value = f"https://{value}"
    if re.match(r"^https?://", value, re.I):
        if not canonical_url(value):
            raise ValueError("Enter a public HTTP or HTTPS article URL.")
        input_url = value
        original = providers.extract(value)
        if not original:
            raise ValueError("Tavily could not extract this article. Paste the headline or claim instead.")
        identified = providers.complete(
            "Return JSON with a claim field containing one central factual claim made by the article. "
            "Use at most 60 words. Return an empty claim if there is no identifiable factual claim.",
            {"title": original.title, "article": original.content[:8500]},
        ).get("claim")
        if not isinstance(identified, str) or not identified.strip():
            raise ValueError("The article did not yield a clear factual claim. Paste the statement to trace.")
        claim = identified.strip()[:400]

    documents = {}
    for query in (claim, f"{claim[:330]} original source evidence fact check"):
        try:
            for document in providers.search(query):
                key = canonical_url(document.url)
                previous = documents.get(key)
                if not previous or (previous.content_basis == "Search excerpt" and document.content_basis != "Search excerpt"):
                    if previous and not document.published:
                        document.published, document.date_basis = previous.published, previous.date_basis
                    documents[key] = document
                elif previous and not previous.published:
                    previous.published, previous.date_basis = document.published, document.date_basis
        except (httpx.HTTPError, ValueError):
            warnings.append("One Tavily search failed. This trace uses the results that were available.")
    if original:
        key = canonical_url(original.url)
        if document := documents.pop(key, None):
            original.published, original.date_basis = document.published, document.date_basis
            original.title = document.title
        documents = {key: original, **documents}
    if not documents and warnings:
        raise RuntimeError("Tavily did not return usable results. Check the search API configuration and retry.")
    return claim, input_url, list(documents.items())[:18], list(dict.fromkeys(warnings))


def trace(value: str, settings: Settings) -> TraceResult:
    with httpx.Client(timeout=httpx.Timeout(40, connect=8), follow_redirects=False) as client:
        providers = Providers(client, settings)
        claim, input_url, documents, warnings = collect(providers, value)
        if not documents:
            warnings.append("Tavily found no new pages. Traceback checked previously stored Delta passages.")

        trace_id = uuid4().hex
        retrieved = datetime.now(timezone.utc)
        records = []
        chunks = []
        for index, (canonical, doc) in enumerate(documents):
            text_chunks = split_passages(doc.content)
            if not text_chunks:
                continue
            domain = urlsplit(canonical).hostname
            source = Source(
                id=f"{trace_id}-{index}", title=doc.title, publisher=domain, domain=domain, url=doc.url,
                published=doc.published, date_basis=doc.date_basis, retrieved_at=retrieved, excerpt="",
            )
            records.append((source, canonical, doc.links if doc.content_basis == "Page extraction" else []))
            chunks.extend((source.id, n, text) for n, text in enumerate(text_chunks))
        vectors = providers.embeddings([claim, *(text for _, _, text in chunks)])
        query, *passage_vectors = vectors
        passages = [
            Passage(f"{source_id}-{n}", source_id, text, vector)
            for (source_id, n, text), vector in zip(chunks, passage_vectors, strict=True)
        ]
        store = DeltaStore(settings)
        with store.cursor() as cursor:
            store.initialize(cursor)
            store.ingest(cursor, trace_id, claim, records, passages)
            indexed = []
            if settings.index:
                try:
                    indexed = ai_search(client, settings, claim)
                    if not indexed:
                        warnings.append("Databricks AI Search returned no hits. Delta passage embeddings were used.")
                except (httpx.HTTPError, ValueError, KeyError):
                    warnings.append("Databricks AI Search was unavailable. Delta passage embeddings were used.")
            candidates = store.candidates(cursor, trace_id, indexed)
            best = rank_passages(candidates, query, indexed)
            counts = store.counts(cursor, trace_id)
            retrieval = "Databricks Delta · cosine similarity"
            if any(passage.id in indexed for passage in best.values()):
                retrieval = "Databricks AI Search + Delta cosine"
            if not best:
                return empty_result(claim, input_url, warnings, retrieval, counts)

            rows = store.chronology(cursor, list(best)[:45])
            unique_rows = {row.id: row for row in rows}
            ordered_ids = [source_id for source_id in best if source_id in unique_rows]
            distinct_urls = set()
            selected = set()
            for source_id in ordered_ids:
                canonical = unique_rows[source_id].canonical_url
                if canonical not in distinct_urls:
                    selected.add(source_id)
                    distinct_urls.add(canonical)
                    if len(selected) == 14:
                        break
            rows = [row for row in rows if row.id in selected]
            sources = [
                Source(id=row.id, title=row.title, publisher=row.publisher, domain=row.domain, url=row.url,
                       published=row.published, retrieved_at=row.retrieved_at, date_basis=row.date_basis,
                       kind=row.source_type, excerpt=best[row.id].text)
                for row in rows
            ]

        try:
            assessment = Assessment.model_validate(providers.complete(
                ANALYSIS_PROMPT,
                {"claim": claim, "sources": [
                    source.model_dump(mode="json", include={"id", "title", "domain", "published", "excerpt"})
                    for source in sources
                ]},
            ))
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            logger.warning("Analysis model unavailable or returned an invalid format")
            assessment = None
            warnings.append("The assessment model was unavailable. The retrieved passages remain available for review.")

        result = assemble(claim, input_url, sources, rows, assessment, warnings, retrieval, counts)
        if result.sources:
            with store.cursor() as cursor:
                store.save_details(cursor, trace_id, result.sources)
            result.trace_id = trace_id
        return result


def assemble(claim, input_url, sources, rows, assessment, warnings, retrieval, counts):
    annotations = {source.id: source for source in assessment.sources} if assessment else {}
    if assessment:
        sources = [
            source.model_copy(update=annotations[source.id].model_dump(include={"kind", "stance", "interpretation", "wording"}))
            for source in sources if source.id in annotations and annotations[source.id].relevant
        ]
    ids = {source.id for source in sources}
    if not ids:
        return empty_result(claim, input_url, warnings, retrieval, counts)
    citations = list(dict.fromkeys(source_id for source_id in (assessment.citations if assessment else []) if source_id in ids))
    verdict = assessment.verdict if assessment and citations else "Insufficient Evidence"
    if assessment and verdict == "Insufficient Evidence" and assessment.verdict != verdict:
        warnings.append("The assessment did not include usable evidence citations.")
    summary = assessment.summary if assessment and (citations or assessment.verdict == verdict) else (
        "Traceback retrieved relevant passages. The available analysis did not establish whether they support the claim."
    )
    dated = next((source for source in sources if source.published), None)
    if dated and sum(source.published == dated.published for source in sources) > 1:
        warnings.append("Multiple sources share the earliest recorded date. Their within-day order is uncertain.")
    original = next((source.id for source in sources if assessment and source.id == assessment.original_id
                     and source.kind in {"Primary evidence", "Press release"}), None)
    urls = {row.canonical_url: row.id for row in rows if row.id in ids}
    relationships = [
        Relationship(source=row.id, target=urls[link], proof="A direct hyperlink appears in the extracted source content.")
        for row in rows if row.id in ids
        for link in json.loads(row.outbound_links or "[]") if link in urls and urls[link] != row.id
    ]
    return TraceResult(
        mode="live", claim=claim, input_url=input_url, verdict=verdict, summary=summary,
        citations=citations, earliest_id=dated.id if dated else None, original_id=original,
        sources=sources, relationships=relationships, warnings=warnings, retrieval=retrieval,
        stored_sources=counts[0], stored_passages=counts[1],
    )
