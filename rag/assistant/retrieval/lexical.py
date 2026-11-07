"""BM25 over the chunks of each strategy, rebuilt when the chunks of that strategy or the clinic profile change."""
import importlib
import re
import unicodedata

from rank_bm25 import BM25Okapi

from assistant.clinic.profile import ClinicProfileSource, Lexicon
from assistant.retrieval.chunks import ChunkSource
from assistant.retrieval.lexical_options import LexicalOptions

DEFAULT_OPTIONS = LexicalOptions()
# Código do idioma do perfil -> nome do algoritmo do PyStemmer. Idioma fora da lista é erro com a mensagem dizendo isso.
SNOWBALL_ALGORITHMS = {
    "en": "english", "pt": "portuguese", "es": "spanish", "fr": "french", "de": "german", "it": "italian",
}
# Listas de palavras por idioma, lidas da biblioteca uma vez por processo. Dicionário e não lru_cache: uma falha
# (biblioteca ausente) não fica guardada, e os testes podem zerá-lo. Só listas imutáveis entram aqui; o stemmer não,
# porque a documentação do PyStemmer proíbe chamá-lo em paralelo e o serviço HTTP pode atender em threads.
_stopwords_by_language: dict[str, frozenset[str]] = {}


def _plain(text):
    """Minúsculas e sem acento."""
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def _plural(word):
    """Corta o "s" do plural (o padrão do projeto)."""
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _library(module_name, pip_name):
    """Importa uma biblioteca opcional só quando uma opção a pede."""
    try:
        return importlib.import_module(module_name)
    except ImportError as error:
        raise ImportError(
            f"the lexical option needs the package {pip_name}; install it with: pip install {pip_name}"
        ) from error


def _language_or_refuse(lexicon: Lexicon, option):
    if lexicon.language is None:
        raise ValueError(f"the lexicon has no language, so the lexical option {option} cannot choose a library list")
    return lexicon.language


def _stopwords_of(lexicon: Lexicon, choice):
    if choice == "profile":
        return lexicon.stopwords
    if choice == "none":
        return frozenset()
    language = _language_or_refuse(lexicon, "stopwords=stopwordsiso")
    if language not in _stopwords_by_language:
        words = _library("stopwordsiso", "stopwordsiso").stopwords(language)
        if not words:
            raise ValueError(
                f'the stopwordsiso package has no stopword list for language "{language}"; '
                "use stopwords: profile or none"
            )
        _stopwords_by_language[language] = frozenset(_plain(word) for word in words)
    return _stopwords_by_language[language]


def _synonyms_of(lexicon: Lexicon, choice):
    if choice == "profile":
        return lexicon.synonyms
    if choice == "none":
        return {}
    return lexicon.generic_synonyms


def _stemmer_of(lexicon: Lexicon, choice):
    """Função palavra -> radical. O stemmer do PyStemmer é criado a cada chamada de tokenize (não é compartilhável)."""
    if choice == "plural":
        return _plural
    if choice == "none":
        return lambda word: word
    language = _language_or_refuse(lexicon, "stemmer=snowball")
    library = _library("Stemmer", "PyStemmer")
    algorithm = SNOWBALL_ALGORITHMS.get(language)
    if algorithm is None or algorithm not in library.algorithms():
        raise ValueError(
            f'the PyStemmer package has no stemmer for language "{language}"; use stemmer: plural or none'
        )
    return library.Stemmer(algorithm).stemWord


def tokenize(text, lexicon: Lexicon, expand=False, options: LexicalOptions = DEFAULT_OPTIONS):
    """Words without accents, punctuation, stop words, or the plural "s".

    expand=True adds the brochure's terms that mean the same as the question's ("cost" -> "price").
    options chooses the stop words, the stemmer and the synonyms (see LexicalOptions); the defaults are the project's.
    """
    stopwords = _stopwords_of(lexicon, options.stopwords)
    synonyms = _synonyms_of(lexicon, options.synonyms)
    stem = _stemmer_of(lexicon, options.stemmer)
    tokens = []
    for word in re.findall(r"[a-z0-9]+", _plain(text)):
        if word in stopwords:
            continue
        words = [word, *synonyms.get(word, ())] if expand else [word]
        tokens.extend(stem(item) for item in words)
    return tokens


class LexicalIndex:
    """BM25 index per strategy and per set of options, kept by the instance. An index is rebuilt when the chunk source
    or the clinic profile reports another version, so an index that another process wrote is used on the next question,
    and a changed lexicon is used too. Each (strategy, options) pair is rebuilt only when it is asked for.
    """

    def __init__(self, chunk_source: ChunkSource, clinic: ClinicProfileSource):
        self._chunk_source = chunk_source
        self._clinic = clinic
        self._built: dict[tuple[str, LexicalOptions], tuple[tuple[str | None, str], BM25Okapi, list[str]]] = {}

    def get(self, strategy: str, options: LexicalOptions = DEFAULT_OPTIONS) -> tuple[BM25Okapi, list[str]]:
        key = (self._chunk_source.version(strategy), self._clinic.version())
        slot = (strategy, options)
        built = self._built.get(slot)
        if built is None or built[0] != key:
            documents = self._chunk_source.chunks(strategy)
            lexicon = self._clinic.load().lexicon
            built = (key, BM25Okapi([tokenize(document, lexicon, options=options) for document in documents]), documents)
            self._built[slot] = built
        return built[1], built[2]
