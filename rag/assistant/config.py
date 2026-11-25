import os
from pathlib import Path

from dotenv import load_dotenv

# The provider logic lives in assistant.model_settings. The names are re-exported here because other modules and tests
# import them from assistant.config.
from assistant.model_settings import (  # noqa: F401
    DEFAULT_CLOUD_TIMEOUT_S,
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_OLLAMA_CHAT_MODEL,
    DEFAULT_OLLAMA_EMBEDDING_MODEL,
    NVIDIA_PRODUCTION_REFUSAL,
    PRESETS,
    PROVIDERS,
    ModelSettings,
    index_dir_name,
    load_shared_env,
    resolve_model_settings,
)

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
# The repository's root .env holds the MODEL_* settings the Node server also reads. rag/.env and the real environment win.
load_shared_env(ROOT.parent / ".env", os.environ)

# Chat and embedding models: the settings the environment asks for (see assistant.model_settings).
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
INDEX_DIR = Path(os.getenv("INDEX_DIR") or ROOT / "data" / index_dir_name(MODEL_SETTINGS.provider))

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
