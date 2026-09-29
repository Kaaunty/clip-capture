"""Configuration loader for Clip Capture Agent."""

import json
from pathlib import Path
from typing import Any

from apps.agent.src.models import AgentConfig


def load_agent_config(data: dict[str, Any] | str | Path) -> AgentConfig:
    """Load and validate AgentConfig from a dictionary, JSON string, or file path."""
    if isinstance(data, (str, Path)):
        path = Path(data)
        if path.is_file():
            content = path.read_text(encoding="utf-8")
            raw_dict = json.loads(content)
            return AgentConfig.model_validate(raw_dict)
        raw_dict = json.loads(str(data))
        return AgentConfig.model_validate(raw_dict)

    return AgentConfig.model_validate(data)
