"""Contrato do perfil da clínica: o que o assistente diz e como ele lê a pergunta, para uma clínica e um idioma.

Os textos já vêm com os dados da clínica preenchidos; só ficam de fora os placeholders de cada pergunta
({knowledge}, {conversation}, {ask} e {no_answer}), que o prompt preenche na hora.
"""
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol


class ClinicProfileError(Exception):
    """Perfil inválido. A mensagem diz o que corrigir (em inglês, porque é lida pelo operador)."""


@dataclass(frozen=True)
class Lexicon:
    """Léxico da busca por palavras: as palavras que não contam e os sinônimos da pergunta para a cartilha."""

    stopwords: frozenset[str]
    synonyms: Mapping[str, tuple[str, ...]]  # palavra da pergunta -> palavras como a cartilha as escreve (clínica e idioma)
    language: str | None = None  # idioma do perfil: escolhe a lista da biblioteca nas opções lexicais
    generic_synonyms: Mapping[str, tuple[str, ...]] = field(default_factory=dict)  # só os do idioma, sem os da clínica


@dataclass(frozen=True)
class ClinicProfile:
    name: str
    kind: str
    language: str
    no_answer: str
    no_information: str
    no_conversation: str
    conversation_roles: dict  # role do chat -> rótulo no prompt
    original_separator: str
    system_prompt: str  # ainda tem {no_answer}
    user_template: str
    standalone_prompt: str
    original_template: str
    hyde_prompt: str
    afterthought: re.Pattern  # o que o modelo escreve depois da resposta
    greeting: re.Pattern  # saudação no início da resposta
    refusal_offer: str  # the offer after the refusal sentence: written by the code, never by the model
    small_talk: re.Pattern  # the whole customer message is only greetings, thanks or goodbyes
    lexicon: Lexicon  # idioma e clínica juntos: o que a busca por palavras lê


class ClinicProfileSource(Protocol):
    """Quem entrega o perfil. version() muda quando o conteúdo do perfil muda, para o perfil ser relido."""

    def load(self) -> ClinicProfile: ...

    def version(self) -> str: ...
