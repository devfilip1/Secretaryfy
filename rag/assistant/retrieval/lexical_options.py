"""Opções da busca por palavras (BM25): como o texto é analisado. Os defaults são o comportamento anterior às opções.

Cada experimento de config/experiments.yaml escolhe as suas na chave "lexical". Valor fora da lista é erro.
"""
from dataclasses import dataclass

STOPWORDS_CHOICES = ("profile", "none", "stopwordsiso")
STEMMER_CHOICES = ("plural", "none", "snowball")
SYNONYMS_CHOICES = ("profile", "none", "generic")
CHOICES = {"stopwords": STOPWORDS_CHOICES, "stemmer": STEMMER_CHOICES, "synonyms": SYNONYMS_CHOICES}


@dataclass(frozen=True)
class LexicalOptions:
    # profile: a lista do perfil (padrão); none: nenhuma; stopwordsiso: a lista da biblioteca para o idioma do perfil
    stopwords: str = "profile"
    # plural: corta o "s" final (padrão); none: nada; snowball: radical do PyStemmer para o idioma do perfil
    stemmer: str = "plural"
    # profile: sinônimos do idioma e da clínica (padrão); none: nenhum; generic: só os do idioma
    synonyms: str = "profile"

    def __post_init__(self):
        for name, choices in CHOICES.items():
            value = getattr(self, name)
            if value not in choices:
                raise ValueError(f'lexical {name} "{value}" does not exist; use one of: {", ".join(choices)}')

    @classmethod
    def from_mapping(cls, data):
        """Lê o mapa "lexical" de um experimento; sem ele valem os defaults."""
        if data is None:
            return cls()
        if not isinstance(data, dict):
            raise ValueError("lexical must be a mapping with the keys stopwords, stemmer and synonyms")
        unknown = [str(key) for key in data if key not in CHOICES]
        if unknown:
            raise ValueError(f"unknown lexical option: {', '.join(unknown)}; use: stopwords, stemmer, synonyms")
        return cls(**data)
