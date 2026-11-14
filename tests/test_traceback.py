import json
import unittest
from contextlib import nullcontext
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.demo import DEMO_CLAIM
from backend.main import app
from backend.pipeline import Assessment, assemble, rank_passages
from backend.providers import Document, canonical_url, publication_date, split_passages
from backend.settings import Settings
from backend.store import Passage


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_cached_demo_and_inspector(self):
        response = self.client.post("/api/trace", json={"mode": "demo"})
        self.assertEqual(response.status_code, 200)
        demo = response.json()
        self.assertEqual(demo["mode"], "demo")
        self.assertEqual(demo["claim"], DEMO_CLAIM)
        sources = {entry["id"]: entry for entry in demo["sources"]}
        self.assertEqual(len(sources), 5)
        self.assertEqual(list(source["published"] for source in sources.values()), sorted(
            source["published"] for source in sources.values()
        ))
        self.assertIn(demo["original_id"], sources)
        self.assertEqual(demo["stored_sources"], 0)
        for edge in demo["relationships"]:
            self.assertIn(edge["source"], sources)
            self.assertIn(edge["target"], sources)
        for source_id in demo["citations"]:
            detail = self.client.get(f"/api/sources/{source_id}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json(), sources[source_id])

    def test_missing_credentials_and_invalid_demo_are_explicit(self):
        settings = Settings(tavily="", openai="", db_host="", db_path="", db_token="")
        with patch("backend.main.settings", settings):
            self.assertFalse(self.client.get("/api/health").json()["live_configured"])
            live = self.client.post("/api/trace", json={"claim": "A new claim"})
            self.assertEqual(live.status_code, 503)
            self.assertIn("TAVILY_API_KEY", live.json()["detail"])
            self.assertEqual(self.client.post("/api/trace", json={"mode": "demo", "claim": "A new claim"}).status_code, 422)
            self.assertEqual(self.client.get("/api/sources/missing").status_code, 404)

    def test_live_trace_reads_delta_rows_and_reuses_corpus(self):
        settings = Settings(tavily="test", openai="test", db_host="example.com", db_path="/test", db_token="test", index="")
        document = Document("https://example.org/article", "Example article", "A passage " * 40, date(2020, 1, 1))
        prior = Passage("prior-passage", "prior-source", "A prior passage ranked by cosine", [0.9, 0.1])
        with patch("backend.main.settings", settings), patch("backend.pipeline.Providers") as Provider, patch("backend.pipeline.DeltaStore") as Store:
            provider = Provider.return_value
            provider.search.return_value = [document]
            provider.embeddings.side_effect = lambda texts: [[1.0, 0.0] for _ in texts]
            store = Store.return_value
            store.cursor.side_effect = lambda: nullcontext("cursor")
            fresh = []
            store.ingest.side_effect = lambda cursor, trace_id, claim, records, passages: fresh.extend(passages)
            store.candidates.side_effect = lambda *args: [*fresh, prior]
            store.counts.return_value = (1, 1)

            def chronology(cursor, ids):
                rows = [
                    SimpleNamespace(id="prior-source", title="Primary report", publisher="publisher.org",
                                    domain="publisher.org", url="https://publisher.org/report", published=date(2019, 1, 1),
                                    retrieved_at=None, date_basis="Publisher", source_type="Primary evidence",
                                    outbound_links="[]", canonical_url="https://publisher.org/report"),
                    SimpleNamespace(id=fresh[0].source_id, title="Example article", publisher="example.org",
                                    domain="example.org", url=document.url, published=document.published,
                                    retrieved_at=None, date_basis="Provider", source_type="Other",
                                    outbound_links=json.dumps(["https://publisher.org/report"]), canonical_url=document.url),
                ]
                return [row for row in rows if row.id in ids]

            store.chronology.side_effect = chronology
            provider.complete.side_effect = lambda prompt, data: {
                "verdict": "Supported", "summary": "The primary report provides support.", "citations": ["prior-source", "invented"],
                "original_id": "prior-source", "sources": [
                    {"id": row["id"], "relevant": True, "kind": "Primary evidence" if row["id"] == "prior-source" else "Reporting",
                     "stance": "Supports", "interpretation": "Evidence interpretation.", "wording": "Wording."}
                    for row in data["sources"]
                ],
            }
            response = self.client.post("/api/trace", json={"claim": "Evidence of an example claim"})
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(data["retrieval"], "Databricks Delta · cosine similarity")
            self.assertEqual(data["earliest_id"], "prior-source")
            self.assertEqual(data["original_id"], "prior-source")
            self.assertEqual(data["citations"], ["prior-source"])
            self.assertEqual(data["relationships"][0]["target"], "prior-source")
            self.assertEqual(data["sources"][0]["excerpt"], prior.text)
            self.assertEqual(data["stored_passages"], 1)
            saved = store.save_details.call_args.args
            self.assertEqual(saved[1], data["trace_id"])
            self.assertEqual(saved[2][0].id, "prior-source")


class RetrievalTests(unittest.TestCase):
    def test_url_identity_dates_and_excerpts(self):
        self.assertEqual(canonical_url("https://www.example.org/article/?utm_medium=web&id=2#part"), "https://example.org/article?id=2")
        self.assertIsNone(canonical_url("http://127.0.0.1/test"))
        self.assertIsNone(publication_date("November 2020"))
        doc = Document("https://example.org", "Example", "[a reference](https://www.source.org/report) " + "evidence " * 30)
        self.assertEqual(doc.links, ["https://source.org/report"])
        self.assertTrue(split_passages(doc.content)[0].startswith("a reference evidence "))

    def test_ai_rank_and_cosine_fallback(self):
        high = Passage("high", "source", "highest cosine", [1.0, 0.0])
        indexed = Passage("indexed", "source", "selected via index", [0.6, 0.8])
        unrelated = Passage("unrelated", "other", "unrelated", [0.0, 1.0])
        self.assertEqual(rank_passages([high, indexed, unrelated], [1.0, 0.0], []), {"source": high})
        self.assertEqual(rank_passages([high, indexed, unrelated], [1.0, 0.0], ["indexed", "unrelated"]), {"source": indexed})

    def test_empty_result_does_not_keep_uncited_verdict(self):
        assessment = Assessment(verdict="Supported", summary="Invalid support.", citations=["invented"], original_id=None, sources=[])
        result = assemble("Test claim", None, [], [], assessment, [], "Delta", (1, 1))
        self.assertEqual(result.verdict, "Insufficient Evidence")
        self.assertEqual(result.citations, [])
        self.assertIsNone(result.earliest_id)


if __name__ == "__main__":
    unittest.main()
