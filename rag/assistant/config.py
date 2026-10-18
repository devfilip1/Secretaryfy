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
COLLECTION_NAME = "raglab"

# Fixes applied to the extracted text, as {wrong: right}. The current brochure needs none.
TEXT_FIXES = {}

# A line starting with one of these, and the rest of its paragraph, is left out of every index.
# The brochure ends with a note saying its details are fictional; it must never reach the assistant.
IGNORED_LINE_PREFIXES = ("Note:",)

# The brochure opens with the clinic name and its address, hours, and contact, with no heading of their own.
# That opening block becomes a section titled "<clinic name> — <this suffix>".
INTRO_SECTION_SUFFIX = "Clinic Information"

# Words that do not help the word-based search. "much", "long", "where", and "open" are not here on purpose:
# they carry the intent of "how much", "how long", "where are you", and "are you open".
STOPWORDS = frozenset("""
a an the of to in on at for with without from by and or but if so as than then that this these those
is are was were be been being am do does did has have had will would can could should may might must
i me my we us our you your yours he she it its they them their there here
what which who whom how why
not no yes please just also very really about into over up out any some
get got need want like know tell say
""".split())

# How customers ask -> how the brochure writes it. Used only by the word-based search.
QUERY_SYNONYMS = {
    "cost": ("price",), "costs": ("price",), "much": ("price",), "fee": ("price",), "fees": ("price",),
    "charge": ("price",), "expensive": ("price",), "cheap": ("price",), "pay": ("price",),
    "pricing": ("price",), "prices": ("price",),
    "long": ("duration",), "take": ("duration",), "takes": ("duration",), "time": ("duration",),
    "quick": ("duration",), "fast": ("duration",),
    "last": ("durability", "lasting"), "lasts": ("durability", "lasting"),
    "recover": ("recovery",), "heal": ("recovery",), "healing": ("recovery",), "downtime": ("recovery",),
    "pull": ("extraction",), "pulled": ("extraction",), "remove": ("extraction",),
    "removed": ("extraction",), "removal": ("extraction",), "extract": ("extraction",),
    "cavity": ("filling", "decay"), "cavities": ("filling", "decay"),
    "whiten": ("whitening",), "whiter": ("whitening",), "bleach": ("whitening",), "bleaching": ("whitening",),
    "aligners": ("braces",), "invisalign": ("braces", "aligners"), "straighten": ("braces", "alignment"),
    "crooked": ("braces", "alignment"), "orthodontics": ("orthodontic", "braces"),
    "teeth": ("tooth",), "tooth": ("teeth",),
    "where": ("location",), "located": ("location",), "address": ("location",), "directions": ("location",),
    "open": ("hours",), "close": ("hours",), "closed": ("hours",), "opening": ("hours",),
    "weekend": ("hours", "saturday", "sunday"), "weekends": ("hours", "saturday", "sunday"),
    "phone": ("contact",), "call": ("contact",), "number": ("contact",), "email": ("contact",),
    "reach": ("contact",),
    "hurt": ("pain",), "hurts": ("pain",), "painful": ("pain",),
    "installments": ("payment",), "financing": ("payment",), "card": ("payment",),
    "works": ("work",), "done": ("works", "work"),
    "types": ("options",), "kinds": ("options",),
}

# Generation. Temperature 0 because the assistant quotes prices and durations: the same question must get the same answer.
TEMPERATURE = 0.0
MAX_ANSWER_TOKENS = 200   # safety cap; the answers asked for have at most 3 sentences
KEEP_ALIVE = "30m"        # keeps the model loaded between questions, so the load time is not paid again

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "llama3")
OLLAMA_EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")
