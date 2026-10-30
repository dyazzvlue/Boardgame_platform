"""Load external games under stable, non-conflicting package names."""
from __future__ import annotations

import importlib
import importlib.util
import os
from pathlib import Path
import sys
import threading

_lock = threading.RLock()


def load_adapter(game_id: str, repository: str, environment: str, adapter: str):
    root = Path(os.environ.get(
        environment, Path(__file__).resolve().parents[3] / repository
    )).resolve()
    initializer = root / "__init__.py"
    if not initializer.is_file():
        raise ImportError(f"{environment}={root}: missing game package __init__.py")
    package_name = f"boardgame_{game_id}"
    with _lock:
        package = sys.modules.get(package_name)
        if package is not None:
            if Path(package.__file__).resolve() != initializer:
                raise ImportError(f"{package_name} is already loaded from another repository")
        else:
            spec = importlib.util.spec_from_file_location(
                package_name, initializer, submodule_search_locations=[str(root)]
            )
            package = importlib.util.module_from_spec(spec)
            # Normal package registration; no unrelated modules or paths are replaced.
            sys.modules[package_name] = package
            try:
                spec.loader.exec_module(package)
            except BaseException:
                sys.modules.pop(package_name, None)
                raise
        module = importlib.import_module(f"{package_name}.online.adapter")
        return getattr(module, adapter)
