# Shortcuts for the project commands. Usage: make <shortcut> [ARGS="arguments"]
# The same names exist in run.ps1, which works on Windows without installing make.
# A test checks that the two files do not drift apart.

ifeq ($(OS),Windows_NT)
PYTHON ?= .venv/Scripts/python.exe
else
PYTHON ?= .venv/bin/python
endif

ARGS ?=

.DEFAULT_GOAL := help
.PHONY: help install ingest chat test test-integration eval eval-smoke eval-full experiments retrieval kb-check validate compare baseline serve

help: ## List the shortcuts
	@$(PYTHON) -c "import re; [print(f'  {m[1]:<18} {m[2]}') for m in re.finditer(r'^([a-z-]+):.*?## (.+)$$', open('Makefile', encoding='utf-8').read(), re.M)]"

install: ## Install the dependencies
	$(PYTHON) -m pip install -r requirements.txt $(ARGS)

ingest: ## Build the indexes of every strategy
	$(PYTHON) -m assistant.ingest $(ARGS)

chat: ## Chat with the assistant
	$(PYTHON) -m assistant.chat $(ARGS)

test: ## Unit tests (no Ollama needed)
	$(PYTHON) -m pytest $(ARGS)

test-integration: ## Tests with Ollama and the index
	$(PYTHON) -m pytest -m integration $(ARGS)

eval: ## Answer evaluation, without the judge
	$(PYTHON) -m evaluation run --no-judge $(ARGS)

eval-smoke: ## Quick evaluation, 10 questions
	$(PYTHON) -m evaluation run --smoke --no-judge $(ARGS)

eval-full: ## Answer evaluation, with the judge
	$(PYTHON) -m evaluation run $(ARGS)

experiments: ## Compare the search experiments
	$(PYTHON) -m evaluation experiments $(ARGS)

retrieval: ## Search detail of the assistant's experiment
	$(PYTHON) -m evaluation retrieval $(ARGS)

kb-check: ## Check the knowledge base
	$(PYTHON) -m evaluation kb-check $(ARGS)

validate: ## Validate the configuration and the answer key
	$(PYTHON) -m evaluation validate $(ARGS)

compare: ## Compare the latest evaluation with the reference
	$(PYTHON) -m evaluation compare $(ARGS)

baseline: ## Set the latest evaluation as the reference
	$(PYTHON) -m evaluation baseline set $(ARGS)

serve: ## Start the assistant HTTP service
	$(PYTHON) -m server $(ARGS)
