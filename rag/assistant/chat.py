import sys

from assistant.composition import build_embeddings_provider, build_rag_service
from assistant.index import IndexUnavailable, check_embedding_dimensions, require_index
from assistant.retrieval.pipeline import RagConfig
from assistant.settings import SettingsError, get_strategy


def to_ask():
    try:
        config = RagConfig()
        strategy = get_strategy(config.strategy)
        require_index(strategy)
        check_embedding_dimensions(strategy, build_embeddings_provider())
    except SettingsError as error:
        print(f"Invalid configuration: {len(error.problems)} problem(s)")
        for problem in error.problems:
            print(f"  - {problem}")
        return 2
    except IndexUnavailable as error:
        print(f"Could not start: {error}")
        return 1

    service = build_rag_service(config)

    while True:
        ask = input("Type your question: ")

        if ask.lower() in ["exit", "quit"]:
            print("Closing the assistant. See you!")
            break

        if not ask.strip():
            continue

        try:
            result = service.answer(ask)
        except Exception as error:
            print(f"\nCould not get an answer: {error}\n")
            continue
        print(f"\nresponse: {result.answer}\n")
    return 0


if __name__ == "__main__":
    sys.exit(to_ask())
