import logging
from pathlib import Path

import httpx
from databricks.sql.exc import Error as DatabricksError
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .demo import DEMO, DEMO_CLAIM, DEMO_SOURCES
from .models import Health, Source, TraceRequest, TraceResult
from .pipeline import trace
from .settings import Settings
from .store import DeltaStore

logger = logging.getLogger(__name__)
app = FastAPI(title="Traceback API", version="0.1.0")
settings = Settings()


@app.get("/api/health", response_model=Health)
def health():
    missing = settings.missing()
    return Health(live_configured=not missing, ai_search_configured=bool(settings.index), missing=missing)


@app.post("/api/trace", response_model=TraceResult)
def run_trace(request: TraceRequest):
    claim = request.claim.strip()
    if request.mode == "demo":
        if claim and claim.casefold() != DEMO_CLAIM.casefold():
            raise HTTPException(422, "Demo mode serves the verified climate deadline case. Use live mode for your input.")
        return DEMO
    if len(claim) < 5:
        raise HTTPException(422, "Enter a claim, headline, or article URL.")
    if missing := settings.missing():
        raise HTTPException(503, f"Live tracing needs {', '.join(missing)}. The verified demo is available.")
    try:
        return trace(claim, settings)
    except DatabricksError as exc:
        logger.warning("Databricks operation failed (%s)", type(exc).__name__)
        raise HTTPException(502, "Databricks could not finish the trace. Check the SQL warehouse, permissions, and connection settings.") from exc
    except (httpx.HTTPError, RuntimeError) as exc:
        logger.warning("Live trace provider failure (%s)", type(exc).__name__)
        raise HTTPException(502, "A retrieval or model provider could not finish the trace. Check the service configuration and retry.") from exc
    except ValueError as exc:
        # Expose only the expected messages for user-provided article URLs.
        safe = str(exc).startswith(("Enter a public", "Tavily could not extract", "The article did not yield"))
        raise HTTPException(422 if safe else 502, str(exc) if safe else "A provider returned an invalid response.") from exc
    except (KeyError, TypeError, IndexError) as exc:
        logger.warning("Live trace response format error (%s)", type(exc).__name__)
        raise HTTPException(502, "A provider returned an invalid response.") from exc


@app.get("/api/sources/{source_id}", response_model=Source)
def source_details(source_id: str, trace_id: str | None = None):
    source = next((item for item in DEMO_SOURCES if item.id == source_id), None)
    if source:
        return source
    if settings.db_host and settings.db_path and settings.db_token:
        try:
            if source := DeltaStore(settings).source(source_id, trace_id):
                return source
        except (DatabricksError, ValueError) as exc:
            logger.warning("Databricks source lookup failed (%s)", type(exc).__name__)
            raise HTTPException(502, "Databricks source details are temporarily unavailable.") from exc
    raise HTTPException(404, "Source not found.")


dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
