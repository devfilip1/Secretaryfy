import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# the clinic brochure (source) and the indexes built from it by assistant.ingest, one per strategy
SOURCE_PDF = ROOT / "data" / "source" / "DentalSafe.pdf"
INDEX_DIR = ROOT / "data" / "index"

# chunking strategies and search experiments, edited by hand (read by assistant.settings)
CONFIG_DIR = ROOT / "config"
STRATEGIES_PATH = CONFIG_DIR / "strategies.yaml"
EXPERIMENTS_PATH = CONFIG_DIR / "experiments.yaml"
SCHEMAS_DIR = CONFIG_DIR / "schemas"

# the clinic profile (identity and what is specific to its specialty) and one language package per language
CLINIC_PATH = CONFIG_DIR / "clinic.yaml"
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
KEEP_ALIVE = "30m"        # keeps the model loaded between questions, so the load time is not paid again

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "llama3")
OLLAMA_EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")
