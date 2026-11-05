"""HTTP service of the assistant, used by Secretaryfy. Run from rag/: python -m server

It serves the same search and answer as the chat and the evaluation: the experiment in the "assistant:" line of
config/experiments.yaml. Like the chat, it refuses to start with a missing or out-of-date index.
"""
import hmac
import logging
import os
import sys
import threading
import time
import urllib.request
from typing import Annotated, Literal

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints

from assistant.config import INTERNAL_TOKEN, OLLAMA_BASE_URL
from assistant.index import (
    CURRENT, IndexUnavailable, built_from, check_embedding_dimensions, index_state, require_index,
    require_index_for_http_source,
)
from assistant.ingestion.http_source import HttpKnowledgeSource, KnowledgeUnavailable
from assistant.ingestion.service import rebuild_all
from assistant.retrieval.pipeline import RagConfig, RagDeps
from assistant.retrieval.service import RagService
from assistant.composition import (
    build_embeddings_provider,
    build_knowledge_source,
    build_rag_service,
    build_vector_store_provider,
)
from assistant.settings import SettingsError, get_strategy, load_settings

logger = logging.getLogger("rag.server")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8001
OLLAMA_TIMEOUT_S = 2.0


class TurnIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class QuestionIn(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # the messages before the question, oldest first; resolves follow-ups such as "how much does it cost?"
    history: Annotated[list[TurnIn], Field(max_length=20)] = []


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


def _is_bearer(header, token):
    prefix = "Bearer "
    return bool(header) and header.startswith(prefix) and hmac.compare_digest(header[len(prefix):], token)


def _reindex(knowledge, vector_store_provider):
    """Rebuilds the index of every declared strategy from the knowledge now served. The caches of the process follow the new index files."""
    document = knowledge.load()
    counts = rebuild_all(document, load_settings().strategies, vector_store_provider=vector_store_provider)
    return {"chunks": counts, "version": document.version}


def create_app(config, *, service: RagService | None = None, deps: RagDeps | None = None,
               knowledge_source=None, internal_token: str | None = None):
    """knowledge_source and internal_token default to the ones of the process; an empty token turns POST /reindex off."""
    if service is None:
        if deps is None:
            raise ValueError("create_app needs a service or deps")
        service = RagService(config, deps)
    token = INTERNAL_TOKEN if internal_token is None else internal_token

    app = FastAPI(title="Secretaryfy assistant (DentalSafe)")
    reindex_lock = threading.Lock()

    def knowledge():
        return build_knowledge_source() if knowledge_source is None else knowledge_source

    @app.get("/health")
    def health():
        reachable = ollama_reachable()
        source = knowledge()
        kind = "http" if isinstance(source, HttpKnowledgeSource) else "file"
        strategy = get_strategy(config.strategy)
        try:
            version = source.version()
            state, reason = index_state(strategy)
            knowledge_body = {"source": kind, "version": version}
        except KnowledgeUnavailable:
            # judged from the manifest alone: a knowledge server that is down does not make a built index unusable
            state, reason = index_state(strategy, compare_source=False)
            knowledge_body = {"source": kind, "version": None, "reachable": False}
        ready = reachable and state == CURRENT
        body = {
            "status": "ready" if ready else "unavailable",
            "experiment": config.experiment,
            "ollama": {"reachable": reachable, "url": OLLAMA_BASE_URL},
            "index": {"strategy": config.strategy, "state": state, "reason": reason,
                      "built_from": built_from(strategy.name)},
            "knowledge": knowledge_body,
        }
        return JSONResponse(body, status_code=200 if ready else 503)

    if token:
        @app.post("/reindex")
        def post_reindex(authorization: Annotated[str | None, Header()] = None):
            if not _is_bearer(authorization, token):
                raise HTTPException(401, detail="the bearer token is missing or wrong")
            if not reindex_lock.acquire(blocking=False):
                raise HTTPException(409, detail="a reindex is already running")
            try:
                provider = deps.vector_store_provider if deps is not None else build_vector_store_provider()
                return _reindex(knowledge(), provider)
            except KnowledgeUnavailable as error:
                raise HTTPException(503, detail=str(error)) from error
            except Exception as error:
                logger.exception("reindex failed")
                raise HTTPException(503, detail=str(error)) from error
            finally:
                reindex_lock.release()

    @app.post("/answer")
    def post_answer(body: QuestionIn):
        try:
            result = service.answer(body.question, [turn.model_dump() for turn in body.history])
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
            result = service.retrieve(body.question)
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
    warning = None
    try:
        config = RagConfig()
        strategy = get_strategy(config.strategy)
        knowledge = build_knowledge_source()
        if isinstance(knowledge, HttpKnowledgeSource):
            warning = require_index_for_http_source(strategy, knowledge)
        else:
            require_index(strategy)
        check_embedding_dimensions(strategy, build_embeddings_provider())
    except SettingsError as error:
        print(f"Invalid configuration: {len(error.problems)} problem(s)")
        for problem in error.problems:
            print(f"  - {problem}")
        sys.exit(2)
    except IndexUnavailable as error:
        print(f"Could not start: {error}")
        sys.exit(1)

    if warning:
        print(f"Warning: {warning}")
    # assistant.config has already loaded rag/.env
    host = os.getenv("RAG_HOST", DEFAULT_HOST)
    port = int(os.getenv("RAG_PORT", DEFAULT_PORT))
    uvicorn.run(create_app(config, service=build_rag_service(config)), host=host, port=port)


if __name__ == "__main__":
    main()
