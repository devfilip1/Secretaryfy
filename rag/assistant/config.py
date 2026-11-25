import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
# The repository's root .env holds the MODEL_* settings the Node server also reads. Only those keys (and NODE_ENV) are
# copied, and never over a value already set: rag/.env and the real environment still win.
_ROOT_ENV = ROOT.parent / ".env"
if _ROOT_ENV.is_file():
    for _key, _value in dotenv_values(_ROOT_ENV).items():
        if _value is not None and (_key.startswith("MODEL_") or _key == "NODE_ENV"):
            os.environ.setdefault(_key, _value)

# Chat and embedding models. MODEL_PROVIDER picks the backend: "ollama" (local, the default) or a cloud provider through
# the OpenAI-compatible protocol. resolve_model_settings takes the environment as an argument, so tests do not reload this.
PROVIDERS = ("ollama", "openai-compatible", "nvidia")
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_CHAT_MODEL = "qwen3:8b"
DEFAULT_OLLAMA_EMBEDDING_MODEL = "embeddinggemma"
DEFAULT_CLOUD_TIMEOUT_S = 20.0
# What each known provider uses unless a MODEL_* variable (or MODEL_EXTRA_BODY, as a whole) overrides it.
PRESETS = {
    "nvidia": {
        "base_url": "https://integrate.api.nvidia.com/v1",
        "chat_model": "nvidia/nemotron-3-ultra-550b-a55b",
        "embedding_model": "nvidia/nemotron-3.5-embed-8b",
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
        "max_per_minute": 35,
        "timeout_s": 60.0,
    },
}
NVIDIA_PRODUCTION_REFUSAL = (
    "MODEL_PROVIDER=nvidia cannot run with NODE_ENV=production: the free NVIDIA Build tier is for development and "
    "evaluation only and must not receive real patient conversations"
)


@dataclass(frozen=True)
class ModelSettings:
    provider: str
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    chat_model: str = ""
    embedding_model: str = ""
    extra_body: dict = field(default_factory=dict)  # merged into every chat request
    max_tokens: int | None = None  # the cap used when a call gives none
    max_per_minute: int | None = None  # client-side limit of HTTP requests; None: no limit
    timeout_s: float = DEFAULT_CLOUD_TIMEOUT_S


def _whole_number(env, name, default):
    raw = env.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a whole number") from None
    if value <= 0:
        raise ValueError(f"{name} must be a positive whole number")
    return value


def _seconds(env, name, default):
    raw = env.get(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number of seconds") from None
    if not value > 0:  # also refuses NaN
        raise ValueError(f"{name} must be a positive number of seconds")
    return value


def _extra_body(raw):
    try:
        value = json.loads(raw)
    except ValueError:
        raise ValueError("MODEL_EXTRA_BODY must be a JSON object") from None
    if not isinstance(value, dict):
        raise ValueError("MODEL_EXTRA_BODY must be a JSON object")
    return value


def resolve_model_settings(env: Mapping[str, str]) -> ModelSettings:
    """The model settings the environment asks for. Errors name the variables at fault, never their values."""
    provider = (env.get("MODEL_PROVIDER") or "ollama").strip().lower()
    if provider not in PROVIDERS:
        raise ValueError(f"MODEL_PROVIDER must be one of: {', '.join(PROVIDERS)}")
    if provider == "ollama":
        return ModelSettings(
            provider=provider,
            base_url=env.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL),
            chat_model=env.get("OLLAMA_CHAT_MODEL", DEFAULT_OLLAMA_CHAT_MODEL),
            embedding_model=env.get("OLLAMA_EMBEDDING_MODEL", DEFAULT_OLLAMA_EMBEDDING_MODEL),
        )
    if provider == "nvidia" and env.get("NODE_ENV") == "production":
        raise ValueError(NVIDIA_PRODUCTION_REFUSAL)

    preset = PRESETS.get(provider, {})
    values = {
        "MODEL_BASE_URL": env.get("MODEL_BASE_URL") or preset.get("base_url"),
        "MODEL_API_KEY": env.get("MODEL_API_KEY"),
        "MODEL_NAME": env.get("MODEL_NAME") or preset.get("chat_model"),
        "MODEL_EMBEDDING_NAME": env.get("MODEL_EMBEDDING_NAME") or preset.get("embedding_model"),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ValueError(f"MODEL_PROVIDER={provider} needs: {', '.join(missing)}")

    extra_raw = env.get("MODEL_EXTRA_BODY")
    return ModelSettings(
        provider=provider,
        base_url=values["MODEL_BASE_URL"],
        api_key=values["MODEL_API_KEY"],
        chat_model=values["MODEL_NAME"],
        embedding_model=values["MODEL_EMBEDDING_NAME"],
        extra_body=_extra_body(extra_raw) if extra_raw else dict(preset.get("extra_body", {})),
        max_tokens=_whole_number(env, "MODEL_MAX_TOKENS", None),
        max_per_minute=_whole_number(env, "MODEL_MAX_PER_MINUTE", preset.get("max_per_minute")),
        timeout_s=_seconds(env, "MODEL_TIMEOUT_S", preset.get("timeout_s", DEFAULT_CLOUD_TIMEOUT_S)),
    )


MODEL_SETTINGS = resolve_model_settings(os.environ)
# The names the RAG uses by default: the Ollama ones under "ollama", the cloud ones otherwise.
CHAT_MODEL = MODEL_SETTINGS.chat_model
EMBEDDING_MODEL = MODEL_SETTINGS.embedding_model

# The clinic and where its knowledge, indexes and answer key are. Each one can be pointed elsewhere with an environment
# variable, to run another clinic (for example the Portuguese one) without touching the default: see docs/development.md.
# The knowledge is a PDF brochure or, for any other extension, a Markdown file (one "## Title" per subject).
SOURCE_PDF = Path(os.getenv("KNOWLEDGE_PATH") or ROOT / "data" / "source" / "DentalSafe.pdf")
# When set, the knowledge comes from the Node server instead of the file: GET this URL with the bearer token INTERNAL_TOKEN
KNOWLEDGE_URL = os.getenv("KNOWLEDGE_URL", "").strip()
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "").strip()  # also protects POST /reindex; empty turns that route off
# When set, the clinic's name and kind come from the Node server: GET this URL with INTERNAL_TOKEN (its /internal/clinic)
CLINIC_URL = os.getenv("CLINIC_URL", "").strip()
# the indexes built from the knowledge by assistant.ingest, one per strategy. A cloud provider gets its own directory:
# its vectors have another size, so they must never overwrite the local index. An explicit INDEX_DIR still wins.
INDEX_DIR = Path(os.getenv("INDEX_DIR") or ROOT / "data" / ("index" if MODEL_SETTINGS.provider == "ollama"
                                                             else f"index-{MODEL_SETTINGS.provider}"))

# chunking strategies and search experiments, edited by hand (read by assistant.settings)
CONFIG_DIR = ROOT / "config"
STRATEGIES_PATH = CONFIG_DIR / "strategies.yaml"
EXPERIMENTS_PATH = CONFIG_DIR / "experiments.yaml"
SCHEMAS_DIR = CONFIG_DIR / "schemas"

# the clinic profile (identity and what is specific to its specialty) and one language package per language
CLINIC_PATH = Path(os.getenv("CLINIC_PATH") or CONFIG_DIR / "clinic.yaml")
LANGUAGES_DIR = CONFIG_DIR / "languages"

COLLECTION_NAME = "raglab"

# Fixes applied to the extracted text, as {wrong: right}. The current brochure needs none.
TEXT_FIXES = {}

# A line starting with one of these, and the rest of its paragraph, is left out of every index.
# The brochure ends with a note saying its details are fictional; it must never reach the assistant.
IGNORED_LINE_PREFIXES = ("Note:",)

# The brochure opens with the clinic name and its address, hours, and contact, with no heading of their own.
# That opening block becomes a section titled "<clinic name> — <this suffix>".
INTRO_SECTION_SUFFIX = "Clinic Information"

# Generation. Temperature 0 because the assistant quotes prices and durations: the same question must get the same answer.
TEMPERATURE = 0.0
MAX_ANSWER_TOKENS = 200   # safety cap; the answers asked for have at most 3 short messages
THINKING_ANSWER_TOKENS = 2000   # answer budget when thinking is on: the thinking uses it too; the usual cap of 200 would cut it
KEEP_ALIVE = "30m"        # keeps the model loaded between questions, so the load time is not paid again

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL)
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", DEFAULT_OLLAMA_CHAT_MODEL)
OLLAMA_EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", DEFAULT_OLLAMA_EMBEDDING_MODEL)
# Thinking of the chat models that think (qwen3): "off" (default) answers at once, "on" thinks first: a bit more right, about 5 times slower, and it can end with an empty answer.
OLLAMA_THINKING = os.getenv("OLLAMA_THINKING", "off").strip().lower() in ("on", "1", "true", "yes")
# Grounded answers: the model quotes the knowledge and the code checks the quote before the answer is given. Off by default.
RAG_GROUNDED = os.getenv("RAG_GROUNDED", "").lower() in ("1", "true", "yes", "on")
# Support check of grounded answers: one more model call checks that the quote states the answer. Only with RAG_GROUNDED.
RAG_VERIFY_SUPPORT = os.getenv("RAG_VERIFY_SUPPORT", "").lower() in ("1", "true", "yes", "on")
