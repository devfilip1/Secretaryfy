import sys

from assistant.composition import build_rag_service
from assistant.index import IndexUnavailable, require_index
from assistant.pipeline import RagConfig
from assistant.settings import SettingsError, get_strategy


def to_ask():
    try:
        config = RagConfig()
        require_index(get_strategy(config.strategy))
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

        print("\nresponse: ", end="", flush=True)
        for piece in service.stream_answer(ask):
            print(piece, end="", flush=True)
        print("\n")
    return 0


if __name__ == "__main__":
    sys.exit(to_ask())
