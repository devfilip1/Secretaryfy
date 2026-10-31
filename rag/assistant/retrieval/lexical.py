"""BM25 over the chunks of each strategy, rebuilt when the chunks of that strategy change."""
import re
import unicodedata

from rank_bm25 import BM25Okapi

from assistant.config import QUERY_SYNONYMS, STOPWORDS
from assistant.retrieval.chunks import ChunkSource


def tokenize(text, expand=False):
    """Words without accents, punctuation, stop words, or the plural "s".

    expand=True adds the brochure's terms that mean the same as the question's ("cost" -> "price").
    """
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    tokens = []
    for word in re.findall(r"[a-z0-9]+", text):
        if word in STOPWORDS:
            continue
        words = [word, *QUERY_SYNONYMS.get(word, ())] if expand else [word]
        for word in words:
            if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
                word = word[:-1]
            tokens.append(word)
    return tokens


class LexicalIndex:
    """BM25 index per strategy, kept by the instance. A strategy is rebuilt when its chunk source reports
    another version, so an index that another process wrote is used on the next question.
    """

    def __init__(self, chunk_source: ChunkSource):
        self._chunk_source = chunk_source
        self._built: dict[str, tuple[str | None, BM25Okapi, list[str]]] = {}

    def get(self, strategy: str) -> tuple[BM25Okapi, list[str]]:
        version = self._chunk_source.version(strategy)
        built = self._built.get(strategy)
        if built is None or built[0] != version:
            documents = self._chunk_source.chunks(strategy)
            built = (version, BM25Okapi([tokenize(document) for document in documents]), documents)
            self._built[strategy] = built
        return built[1], built[2]
