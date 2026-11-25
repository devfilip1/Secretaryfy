"""Rules of an evaluation run that uses a cloud model instead of Ollama.

The settings and the providers are injected: CloudRun(settings, providers), where settings is the ModelSettings of
assistant.config and providers is a function returning (generator, embeddings). The providers are only asked for when
the stats are read, so an Ollama run never builds them here.
"""

INVALID_MESSAGE = "the cloud model was rate limited or failed; do not use it as a reference."


class CloudRun:
    def __init__(self, settings, providers):
        self.settings = settings
        self._providers = providers

    @property
    def is_cloud(self):
        return self.settings.provider != "ollama"

    def banner(self):
        return (f"Cloud run: provider {self.settings.provider}, chat model {self.settings.chat_model}, "
                f"embedding model {self.settings.embedding_model}. "
                "The questions are invented; the free tier is for development and evaluation only. "
                "Judge metrics are off (the judge runs on Ollama).")

    def needs_ollama_preflight(self):
        return not self.is_cloud

    def judge_allowed(self):
        return not self.is_cloud

    def stats(self):
        """Calls, rate-limited responses and failures of the cloud model in this process."""
        from assistant.model_stats import collect_model_stats

        return collect_model_stats(*self._providers())

    def summary_line(self, stats):
        return f"model calls: {stats['calls']}, rate limited: {stats['rate_limited']}, failed: {stats['failed']}"

    def is_invalid(self, stats):
        return bool(stats["rate_limited"] or stats["failed"])
