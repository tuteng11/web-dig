import json
import re
from contextlib import contextmanager
from dataclasses import dataclass

from databricks import sql

from .models import Source
from .settings import Settings


@dataclass
class Passage:
    id: str
    source_id: str
    text: str
    embedding: list[float]


class DeltaStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        if any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) for name in (settings.catalog, settings.schema)):
            raise ValueError("Invalid Databricks catalog or schema name")
        self.namespace = f"`{settings.catalog}`.`{settings.schema}`"
        self.sources = f"{self.namespace}.sources"
        self.passages = f"{self.namespace}.passages"
        self.assessments = f"{self.namespace}.source_assessments"

    @contextmanager
    def cursor(self):
        with sql.connect(
            server_hostname=self.settings.db_host,
            http_path=self.settings.db_path,
            access_token=self.settings.db_token,
            use_cloud_fetch=False,
            _socket_timeout=45,
        ) as connection, connection.cursor() as cursor:
            yield cursor

    def initialize(self, cursor):
        cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {self.namespace}")
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {self.sources} (
                id STRING NOT NULL, trace_id STRING NOT NULL, claim STRING, canonical_url STRING,
                url STRING, title STRING, domain STRING, publisher STRING, source_type STRING,
                published DATE, retrieved_at TIMESTAMP, date_basis STRING, outbound_links STRING
            ) USING DELTA
        """)
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {self.passages} (
                id STRING NOT NULL, source_id STRING NOT NULL, trace_id STRING NOT NULL,
                passage_text STRING, embedding_model STRING, embedding ARRAY<FLOAT>, ingested_at TIMESTAMP
            ) USING DELTA TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')
        """)
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {self.assessments} (
                trace_id STRING NOT NULL, source_id STRING NOT NULL, payload STRING, assessed_at TIMESTAMP
            ) USING DELTA
        """)

    def ingest(self, cursor, trace_id, claim, records, passages):
        if not records:
            return
        source_rows = []
        for source, canonical, links in records:
            source_rows.extend([
                source.id, trace_id, claim, canonical, str(source.url), source.title, source.domain,
                source.publisher, source.kind, source.published, source.retrieved_at,
                source.date_basis, json.dumps(links),
            ])
        rows = ", ".join(["(?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS DATE), CAST(? AS TIMESTAMP), ?, ?)"] * len(records))
        cursor.execute(f"INSERT INTO {self.sources} VALUES {rows}", source_rows)

        # Parse the parameterized rows inside Databricks into its native vector type.
        encoded = json.dumps([
            {"id": passage.id, "source_id": passage.source_id, "passage_text": passage.text,
             "embedding": passage.embedding}
            for passage in passages
        ], allow_nan=False)
        cursor.execute(f"""
            INSERT INTO {self.passages}
            SELECT row.id, row.source_id, ?, row.passage_text, ?, row.embedding, current_timestamp()
            FROM explode(from_json(?, 'ARRAY<STRUCT<id:STRING,source_id:STRING,passage_text:STRING,embedding:ARRAY<FLOAT>>>'))
            AS exploded(row)
        """, [trace_id, self.settings.embedding_model, encoded])

    def candidates(self, cursor, trace_id: str, indexed: list[str]) -> list[Passage]:
        columns = "id, source_id, passage_text, to_json(embedding) AS embedding_json"
        cursor.execute(f"SELECT {columns} FROM {self.passages} WHERE trace_id = ?", [trace_id])
        current = cursor.fetchall()
        cursor.execute(f"""
            SELECT {columns} FROM {self.passages}
            WHERE trace_id <> ? AND embedding_model = ?
            ORDER BY ingested_at DESC, id LIMIT 600
        """, [trace_id, self.settings.embedding_model])
        recent = cursor.fetchall()
        indexed_rows = []
        if indexed:
            marks = ", ".join("?" for _ in indexed)
            cursor.execute(f"SELECT {columns} FROM {self.passages} WHERE id IN ({marks})", indexed)
            indexed_rows = cursor.fetchall()
        return list({row.id: Passage(row.id, row.source_id, row.passage_text, json.loads(row.embedding_json or "[]"))
                     for row in [*current, *recent, *indexed_rows]}.values())

    def chronology(self, cursor, ids: list[str]):
        if not ids:
            return []
        marks = ", ".join("?" for _ in ids)
        cursor.execute(f"""
            SELECT id, title, publisher, domain, url, published, retrieved_at,
                date_basis, source_type, outbound_links, canonical_url
            FROM {self.sources} WHERE id IN ({marks})
                ORDER BY published ASC NULLS LAST, id ASC
        """, ids)
        return cursor.fetchall()

    def counts(self, cursor, trace_id: str):
        cursor.execute(f"""
            SELECT
                (SELECT count(*) FROM {self.sources} WHERE trace_id = ?) AS source_count,
                (SELECT count(*) FROM {self.passages} WHERE trace_id = ?) AS passage_count
        """, [trace_id, trace_id])
        row = cursor.fetchone()
        return row.source_count, row.passage_count

    def save_details(self, cursor, trace_id: str, sources: list[Source]):
        encoded = json.dumps([{"id": source.id, "payload": source.model_dump_json()} for source in sources])
        cursor.execute(f"""
            INSERT INTO {self.assessments}
            SELECT ?, row.id, row.payload, current_timestamp()
            FROM explode(from_json(?, 'ARRAY<STRUCT<id:STRING,payload:STRING>>')) AS exploded(row)
        """, [trace_id, encoded])
        cursor.execute(f"""
            MERGE INTO {self.sources} AS destination
            USING (SELECT source_id, payload FROM {self.assessments} WHERE trace_id = ?) AS updates
            ON destination.id = updates.source_id AND destination.trace_id = ?
            WHEN MATCHED THEN UPDATE SET source_type = get_json_object(updates.payload, '$.kind')
        """, [trace_id, trace_id])

    def source(self, source_id: str, trace_id: str | None) -> Source | None:
        where = "source_id = ?" if trace_id is None else "source_id = ? AND trace_id = ?"
        with self.cursor() as cursor:
            cursor.execute(f"""
                SELECT payload FROM {self.assessments} WHERE {where}
                ORDER BY assessed_at DESC LIMIT 1
            """, [source_id] if trace_id is None else [source_id, trace_id])
            row = cursor.fetchone()
        return Source.model_validate_json(row.payload) if row and row.payload else None
