import json
from pydantic_settings import BaseSettings
from typing import List, Union

class Settings(BaseSettings):
    GEMINI_API_KEY: str = ""
    VIRUSTOTAL_API_KEY: str = ""
    DATABASE_URL: str = "sqlite:///./security_logs.db"
    RAG_DATASET_PATH: str = "./data/merged_security_dataset.csv"
    RAG_DATASET_PATHS: Union[str, List[str]] = [
        "./data/merged_security_dataset.csv",
        "./data/phishing_dataset.csv"
    ]
    CHROMA_DB_PATH: str = "./chroma_db"

    def get_rag_dataset_paths(self) -> List[str]:
        if isinstance(self.RAG_DATASET_PATHS, str):
            try:
                paths = json.loads(self.RAG_DATASET_PATHS)
                if isinstance(paths, list):
                    return paths
            except Exception:
                pass
            return [p.strip() for p in self.RAG_DATASET_PATHS.split(",") if p.strip()]
        return self.RAG_DATASET_PATHS

    class Config:
        env_file = ".env"

settings = Settings()
