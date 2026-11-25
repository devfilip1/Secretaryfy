import json
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values

# Chat and embedding models. MODEL_PROVIDER picks the backend: "ollama" (local, the default) or a cloud provider through
# the OpenAI-compatible protocol. resolve_model_settings takes the environment as an argument, so tests do not reload this.
PROVIDERS = ("ollama", "openai-compatible", "nvidia")
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_CHAT_MODEL = "qwen3:8b"
DEFAULT_OLLAMA_EMBEDDING_MODEL = "embeddinggemma"
DEFAULT_CLOUD_TIMEOUT_S = 20.0
# What each known provider uses unless a MODEL_* variable (or MODEL_EXTRA_BODY, as a whole) overrides it.
PRESETS = {
    "nvidia": {
        "base_url": "https://integrate.api.nvidia.com/v1",
        "chat_model": "nvidia/nemotron-3-ultra-550b-a55b",
        "embedding_model": "nvidia/nemotron-3.5-embed-8b",
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
        "max_per_minute": 35,
        "timeout_s": 60.0,
    },
}
NVIDIA_PRODUCTION_REFUSAL = (
    "MODEL_PROVIDER=nvidia cannot run with NODE_ENV=production: the free NVIDIA Build tier is for development and "
    "evaluation only and must not receive real patient conversations"
)


@dataclass(frozen=True)
class ModelSettings:
    provider: str
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    chat_model: str = ""
    embedding_model: str = ""
    extra_body: dict = field(default_factory=dict)  # merged into every chat request
    max_tokens: int | None = None  # the cap used when a call gives none
    max_per_minute: int | None = None  # client-side limit of HTTP requests; None: no limit
    timeout_s: float = DEFAULT_CLOUD_TIMEOUT_S


def _whole_number(env, name, default):
    raw = env.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a whole number") from None
    if value <= 0:
        raise ValueError(f"{name} must be a positive whole number")
    return value


def _seconds(env, name, default):
    raw = env.get(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number of seconds") from None
    if not value > 0:  # also refuses NaN
        raise ValueError(f"{name} must be a positive number of seconds")
    return value


def _extra_body(raw):
    try:
        value = json.loads(raw)
    except ValueError:
        raise ValueError("MODEL_EXTRA_BODY must be a JSON object") from None
    if not isinstance(value, dict):
        raise ValueError("MODEL_EXTRA_BODY must be a JSON object")
    return value


def resolve_model_settings(env: Mapping[str, str]) -> ModelSettings:
    """The model settings the environment asks for. Errors name the variables at fault, never their values."""
    provider = (env.get("MODEL_PROVIDER") or "ollama").strip().lower()
    if provider not in PROVIDERS:
        raise ValueError(f"MODEL_PROVIDER must be one of: {', '.join(PROVIDERS)}")
    if provider == "ollama":
        return ModelSettings(
            provider=provider,
            base_url=env.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL),
            chat_model=env.get("OLLAMA_CHAT_MODEL", DEFAULT_OLLAMA_CHAT_MODEL),
            embedding_model=env.get("OLLAMA_EMBEDDING_MODEL", DEFAULT_OLLAMA_EMBEDDING_MODEL),
        )
    if provider == "nvidia" and env.get("NODE_ENV") == "production":
        raise ValueError(NVIDIA_PRODUCTION_REFUSAL)

    preset = PRESETS.get(provider, {})
    values = {
        "MODEL_BASE_URL": env.get("MODEL_BASE_URL") or preset.get("base_url"),
        "MODEL_API_KEY": env.get("MODEL_API_KEY"),
        "MODEL_NAME": env.get("MODEL_NAME") or preset.get("chat_model"),
        "MODEL_EMBEDDING_NAME": env.get("MODEL_EMBEDDING_NAME") or preset.get("embedding_model"),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ValueError(f"MODEL_PROVIDER={provider} needs: {', '.join(missing)}")

    extra_raw = env.get("MODEL_EXTRA_BODY")
    return ModelSettings(
        provider=provider,
        base_url=values["MODEL_BASE_URL"],
        api_key=values["MODEL_API_KEY"],
        chat_model=values["MODEL_NAME"],
        embedding_model=values["MODEL_EMBEDDING_NAME"],
        extra_body=_extra_body(extra_raw) if extra_raw else dict(preset.get("extra_body", {})),
        max_tokens=_whole_number(env, "MODEL_MAX_TOKENS", None),
        max_per_minute=_whole_number(env, "MODEL_MAX_PER_MINUTE", preset.get("max_per_minute")),
        timeout_s=_seconds(env, "MODEL_TIMEOUT_S", preset.get("timeout_s", DEFAULT_CLOUD_TIMEOUT_S)),
    )


def load_shared_env(root_env_path: Path, environ: MutableMapping[str, str]) -> None:
    """Copy the MODEL_* keys and NODE_ENV of the root .env into environ, never over a value already set.

    The root .env holds the settings the Node server also reads. Other keys are ignored; a missing file is a no-op.
    """
    if not root_env_path.is_file():
        return
    for key, value in dotenv_values(root_env_path).items():
        if value is not None and (key.startswith("MODEL_") or key == "NODE_ENV"):
            environ.setdefault(key, value)


def index_dir_name(provider: str) -> str:
    """The index directory under data/: Ollama keeps "index"; a cloud provider gets its own, since its vectors differ."""
    return "index" if provider == "ollama" else f"index-{provider}"
