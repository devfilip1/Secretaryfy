"""Contrato do perfil da clínica: o que o assistente diz e como ele lê a pergunta, para uma clínica e um idioma.

Os textos já vêm com os dados da clínica preenchidos; só ficam de fora os placeholders de cada pergunta
({knowledge}, {conversation}, {ask} e {no_answer}), que o prompt preenche na hora.
"""
import re
from dataclasses import dataclass
from typing import Protocol


class ClinicProfileError(Exception):
    """Perfil inválido. A mensagem diz o que corrigir (em inglês, porque é lida pelo operador)."""


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


class ClinicProfileSource(Protocol):
    """Quem entrega o perfil. version() muda quando o conteúdo do perfil muda, para o perfil ser relido."""

    def load(self) -> ClinicProfile: ...

    def version(self) -> str: ...
