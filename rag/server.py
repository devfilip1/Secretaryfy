"""HTTP service of the assistant, used by Secretaryfy. Run from rag/: python -m server

It serves the same search and answer as the chat and the evaluation: the experiment in the "assistant:" line of
config/experiments.yaml. Like the chat, it refuses to start with a missing or out-of-date index.
"""
import logging
import os
import sys
import time
import urllib.request
from typing import Annotated

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from assistant.config import OLLAMA_BASE_URL
from assistant.index import CURRENT, IndexUnavailable, index_state, require_index
from assistant.pipeline import RagConfig, answer, retrieve
from assistant.settings import SettingsError, get_strategy

logger = logging.getLogger("rag.server")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8001
OLLAMA_TIMEOUT_S = 2.0


class QuestionIn(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _chunks(chunks):
    return [
        {"rank": chunk.rank, "content": chunk.content, "score": chunk.score, "similarity": chunk.similarity}
        for chunk in chunks
    ]


def ollama_reachable(url=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_S):
    """True when Ollama answers its cheapest call, which does not load any model."""
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/tags", timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def create_app(config):
    app = FastAPI(title="Secretaryfy assistant (DentalSafe)")

    @app.get("/health")
    def health():
        reachable = ollama_reachable()
        state, reason = index_state(get_strategy(config.strategy))
        ready = reachable and state == CURRENT
        body = {
            "status": "ready" if ready else "unavailable",
            "experiment": config.experiment,
            "ollama": {"reachable": reachable, "url": OLLAMA_BASE_URL},
            "index": {"strategy": config.strategy, "state": state, "reason": reason},
        }
        return JSONResponse(body, status_code=200 if ready else 503)

    @app.post("/answer")
    def post_answer(body: QuestionIn):
        try:
            result = answer(body.question, config)
        except Exception as error:
            logger.exception("answer failed")
            raise HTTPException(503, detail=str(error)) from error
        return {
            "answer": result.answer,
            "chunks": _chunks(result.retrieval.fused),
            "latency_s": result.latency_s,
            "experiment": config.experiment,
        }

    @app.post("/retrieve")
    def post_retrieve(body: QuestionIn):
        start = time.perf_counter()
        try:
            result = retrieve(body.question, config)
        except Exception as error:
            logger.exception("retrieve failed")
            raise HTTPException(503, detail=str(error)) from error
        return {
            "chunks": _chunks(result.fused),
            "latency_s": time.perf_counter() - start,
            "experiment": config.experiment,
        }

    return app


def main():
    try:
        config = RagConfig()
        require_index(get_strategy(config.strategy))
    except SettingsError as error:
        print(f"Invalid configuration: {len(error.problems)} problem(s)")
        for problem in error.problems:
            print(f"  - {problem}")
        sys.exit(2)
    except IndexUnavailable as error:
        print(f"Could not start: {error}")
        sys.exit(1)

    # assistant.config has already loaded rag/.env
    host = os.getenv("RAG_HOST", DEFAULT_HOST)
    port = int(os.getenv("RAG_PORT", DEFAULT_PORT))
    uvicorn.run(create_app(config), host=host, port=port)


if __name__ == "__main__":
    main()
