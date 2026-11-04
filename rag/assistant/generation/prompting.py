from langchain_core.prompts import ChatPromptTemplate

from assistant.clinic.profile import ClinicProfile

# Limites de tokens dos prompts auxiliares (a resposta usa MAX_ANSWER_TOKENS em config.py).
STANDALONE_MAX_TOKENS = 60
HYDE_MAX_TOKENS = 80


def prompt_text(config, clinic: ClinicProfile):
    """The prompt text the configuration uses, to tell apart runs made with different prompts."""
    if config.prompt == "original":
        return clinic.original_template
    return (config.prompt_template or clinic.system_prompt) + (config.user_template or clinic.user_template)


def format_conversation(history, clinic: ClinicProfile):
    """The messages before the question, one per line ("Customer: ..." / "Assistant: ...")."""
    lines = [
        f"{clinic.conversation_roles.get(turn['role'], clinic.conversation_roles['user'])}: {' '.join(turn['content'].split())}"
        for turn in history or []
        if turn.get("content", "").strip()
    ]
    return "\n".join(lines) or clinic.no_conversation


def standalone_question_prompt(question, history, clinic: ClinicProfile):
    return clinic.standalone_prompt.format(conversation=format_conversation(history, clinic), ask=question)


def build_prompt(question, retrieval, config, clinic: ClinicProfile, history=None, extra_system=""):
    if config.prompt == "original":
        knowledge = clinic.original_separator.join(chunk.content for chunk in retrieval.fused)
        return ChatPromptTemplate.from_template(clinic.original_template).invoke({"ask": question, "knowledge": knowledge})

    knowledge = "\n---\n".join(chunk.content for chunk in retrieval.fused) or clinic.no_information
    system = config.prompt_template or clinic.system_prompt
    if extra_system:
        system += "\n\n" + extra_system  # no braces in extra_system: the system text is a template

    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("human", config.user_template or clinic.user_template),
    ])
    return prompt.invoke({
        "ask": question,
        "knowledge": knowledge,
        "conversation": format_conversation(history, clinic),
        "no_answer": clinic.no_answer,
    })


def clean_answer(text, clinic: ClinicProfile, history=None):
    """The answer without the separators and notes about itself that the model sometimes adds at the end and, in an
    ongoing conversation, without the greeting at the start."""
    match = clinic.afterthought.search(text)
    text = (text[:match.start()] if match else text).strip()
    if any(turn.get("role") == "assistant" for turn in history or []):
        rest = clinic.greeting.sub("", text, count=1)
        if rest:
            text = rest[0].upper() + rest[1:]
    if not text.strip():
        # an empty reply (the model ran out of tokens) must not reach the patient
        return clinic.no_answer
    return text
