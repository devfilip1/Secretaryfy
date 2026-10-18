"""Local judge for the subjective criteria.

One call per criterion, a yes/no answer with a JSON schema. The judge's verdicts stay in a separate block
of the scoreboard and never enter the right/wrong of the item.
"""
import json
import os

JUDGE_TEMPERATURE = 0
JUDGE_SEED = 42

CRITERIA = {
    "relevance": {
        "label": "Relevance",
        "rubric": "The answer deals with what the customer asked. Saying it does not have the requested information also deals with the question.",
        "yes": "Question: \"How much is a dental cleaning?\" Answer: \"A dental cleaning costs $40–$85.\"",
        "no": "Question: \"How much is a dental cleaning?\" Answer: \"Dental implants are a long-term solution for your smile.\"",
    },
    "tone": {
        "label": "Tone",
        "rubric": "The tone is friendly and professional, like a clinic attendant talking to a customer.",
        "yes": "\"Of course! A dental cleaning takes 30–50 minutes. Can I help with anything else?\"",
        "no": "\"I already said I don't know. Read the website.\"",
    },
    "scheduling": {
        "label": "Leading to scheduling",
        "rubric": "The answer explicitly invites the customer to schedule an appointment or an assessment.",
        "yes": "\"Teeth whitening costs $180–$450. Shall we schedule your assessment?\"",
        "no": "\"Teeth whitening costs $180–$450.\"",
    },
    "conciseness": {
        "label": "Conciseness",
        "rubric": "The answer is direct: it gives the information without detours, without repeating the question, and without listing information that was not asked for.",
        "yes": "\"A simple extraction costs $50–$90.\"",
        "no": "\"You asked how much an extraction costs. That is a great question! Before answering, it is worth explaining all of our procedures...\"",
    },
    "faithfulness": {
        "label": "Faithfulness (claims)",
        "rubric": "Everything the answer claims about the clinic and the procedures is in the available chunks. Invitations to schedule and courtesy phrases do not count as claims.",
        "yes": "Chunk: \"Duration: 3–6 months\". Answer: \"Dental implants take 3–6 months.\"",
        "no": "Chunk: \"Duration: 3–6 months\". Answer: \"Dental implants take 3–6 months and are done under general anesthesia.\"",
        "needs_chunks": True,
    },
}

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {"reason": {"type": "string"}, "verdict": {"type": "boolean"}},
    "required": ["reason", "verdict"],
}

PROMPT = """You are a strict reviewer of the answers given by the virtual assistant of a dental clinic.
Evaluate only the criterion below and answer in JSON.

CRITERION: {label}
{rubric}

Example that meets the criterion: {yes}
Example that does not meet the criterion: {no}

CUSTOMER QUESTION:
{question}
{chunks}
ASSISTANT ANSWER:
{answer}

Write the reason in one short sentence and then the verdict: true if the answer meets the criterion, false if it does not."""


def judge_model_name(chat_model):
    return os.getenv("OLLAMA_JUDGE_MODEL") or chat_model


def build_prompt(criterion, question, answer, chunks):
    spec = CRITERIA[criterion]
    chunk_block = ""
    if spec.get("needs_chunks"):
        chunk_block = "\nCHUNKS AVAILABLE TO THE ASSISTANT:\n" + "\n---\n".join(chunks) + "\n"
    return PROMPT.format(
        label=spec["label"], rubric=spec["rubric"], yes=spec["yes"], no=spec["no"],
        question=question, answer=answer, chunks=chunk_block,
    )


def parse_verdict(content):
    """Reads the judge's output. Invalid JSON becomes a None verdict, without bringing the run down."""
    try:
        data = json.loads(content)
        verdict = data["verdict"]
        if not isinstance(verdict, bool):
            raise ValueError(f"verdict is not a boolean: {verdict!r}")
        return {"verdict": verdict, "reason": str(data.get("reason", ""))}
    except (ValueError, KeyError, TypeError) as error:
        return {"verdict": None, "reason": f"invalid judge output: {error}"}


def make_judge(model, host=None, chat=None):
    """Returns judge(question, answer, chunks) -> {criterion: {verdict, reason}}."""
    if chat is None:
        import ollama

        chat = ollama.Client(host=host or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")).chat

    def judge(question, answer, chunks):
        verdicts = {}
        for criterion in CRITERIA:
            response = chat(
                model=model,
                messages=[{"role": "user", "content": build_prompt(criterion, question, answer, chunks)}],
                format=RESPONSE_SCHEMA,
                options={"temperature": JUDGE_TEMPERATURE, "seed": JUDGE_SEED},
            )
            verdicts[criterion] = parse_verdict(response.message.content)
        return verdicts

    return judge
