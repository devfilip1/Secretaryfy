"""The Makefile and run.ps1 must offer the same shortcuts, pointing to the same commands."""
import re
from pathlib import Path

ROOT = Path(__file__).parents[2]

EXPECTED = [
    "help", "install", "ingest", "chat", "test", "test-integration", "eval", "eval-smoke", "eval-full",
    "experiments", "retrieval", "kb-check", "validate", "compare", "baseline", "serve",
]


def powershell_shortcuts():
    text = (ROOT / "run.ps1").read_text(encoding="utf-8-sig")  # with BOM, which PowerShell 5 needs to read UTF-8
    entries = re.findall(r'^\s*"([a-z-]+)"\s*=\s*@\("([^"]*)",\s*"([^"]+)"\)', text, re.M)
    return {name: (command, description) for name, command, description in entries}


def make_shortcuts():
    text = (ROOT / "Makefile").read_text(encoding="utf-8")
    shortcuts = {}
    for name, description, recipe in re.findall(r"^([a-z-]+):.*?## (.+)\n\t(.+)$", text, re.M):
        command = recipe.replace("$(PYTHON) ", "").replace(" $(ARGS)", "").lstrip("@")
        shortcuts[name] = (command, description)
    return shortcuts


def test_both_files_declare_the_sixteen_shortcuts_in_the_same_order():
    assert list(powershell_shortcuts()) == EXPECTED
    assert list(make_shortcuts()) == EXPECTED


def test_each_shortcut_runs_the_same_command_in_both_files():
    powershell, make = powershell_shortcuts(), make_shortcuts()

    for name in EXPECTED:
        if name == "help":
            continue  # each file lists the shortcuts in its own way
        assert powershell[name][0] == make[name][0], name
        assert powershell[name][0].startswith("-m "), name


def test_each_shortcut_has_the_same_description_in_both_files():
    powershell, make = powershell_shortcuts(), make_shortcuts()

    for name in EXPECTED:
        assert powershell[name][1] == make[name][1], name
        assert len(powershell[name][1]) > 5, name


def test_makefile_declares_every_target_as_phony():
    text = (ROOT / "Makefile").read_text(encoding="utf-8")
    phony = re.search(r"^\.PHONY: (.+)$", text, re.M).group(1).split()

    assert phony == EXPECTED
