import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class Settings:
    tavily: str = field(default_factory=lambda: os.getenv("TAVILY_API_KEY", ""))
    openai: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", ""))
    chat_model: str = field(default_factory=lambda: os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"))
    embedding_model: str = field(default_factory=lambda: os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
    db_host: str = field(default_factory=lambda: os.getenv("DATABRICKS_SERVER_HOSTNAME", ""))
    db_path: str = field(default_factory=lambda: os.getenv("DATABRICKS_HTTP_PATH", ""))
    db_token: str = field(default_factory=lambda: os.getenv("DATABRICKS_TOKEN", ""))
    catalog: str = field(default_factory=lambda: os.getenv("DATABRICKS_CATALOG", "main"))
    schema: str = field(default_factory=lambda: os.getenv("DATABRICKS_SCHEMA", "traceback"))
    index: str = field(default_factory=lambda: os.getenv("DATABRICKS_VECTOR_INDEX", ""))

    def missing(self) -> list[str]:
        return [
            key for key, value in {
                "TAVILY_API_KEY": self.tavily, "OPENAI_API_KEY": self.openai,
                "DATABRICKS_SERVER_HOSTNAME": self.db_host, "DATABRICKS_HTTP_PATH": self.db_path,
                "DATABRICKS_TOKEN": self.db_token,
            }.items() if not value.strip()
        ]
