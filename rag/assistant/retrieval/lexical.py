"""BM25 over the chunks of each strategy, rebuilt when the chunks of that strategy or the clinic profile change."""
import re
import unicodedata

from rank_bm25 import BM25Okapi

from assistant.clinic.profile import ClinicProfileSource, Lexicon
from assistant.retrieval.chunks import ChunkSource


def tokenize(text, lexicon: Lexicon, expand=False):
    """Words without accents, punctuation, stop words, or the plural "s".

    expand=True adds the brochure's terms that mean the same as the question's ("cost" -> "price").
    """
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    tokens = []
    for word in re.findall(r"[a-z0-9]+", text):
        if word in lexicon.stopwords:
            continue
        words = [word, *lexicon.synonyms.get(word, ())] if expand else [word]
        for word in words:
            if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
                word = word[:-1]
            tokens.append(word)
    return tokens


class LexicalIndex:
    """BM25 index per strategy, kept by the instance. A strategy is rebuilt when its chunk source or the clinic
    profile reports another version, so an index that another process wrote is used on the next question, and a
    changed lexicon is used too.
    """

    def __init__(self, chunk_source: ChunkSource, clinic: ClinicProfileSource):
        self._chunk_source = chunk_source
        self._clinic = clinic
        self._built: dict[str, tuple[tuple[str | None, str], BM25Okapi, list[str]]] = {}

    def get(self, strategy: str) -> tuple[BM25Okapi, list[str]]:
        key = (self._chunk_source.version(strategy), self._clinic.version())
        built = self._built.get(strategy)
        if built is None or built[0] != key:
            documents = self._chunk_source.chunks(strategy)
            lexicon = self._clinic.load().lexicon
            built = (key, BM25Okapi([tokenize(document, lexicon) for document in documents]), documents)
            self._built[strategy] = built
        return built[1], built[2]
