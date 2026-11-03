# Evaluation of the DentalSafe assistant

Measures the quality of the assistant's answers with a fixed set of questions (the answer key) and stores the result of each run, so you can compare before and after a change.

Every command runs from the project root, with the virtual environment active and Ollama running.

## Workflow

```powershell
# 1. change something in the assistant (config/*.yaml, prompt, model)
python -m assistant.ingest                         # only if a strategy or the PDF changed
python -m evaluation experiments                   # if the change is about search: compare the configurations
# 2. run the answer evaluation
python -m evaluation run --label what-i-changed
# 3. the scoreboard already shows the comparison with the reference; to see it again later:
python -m evaluation compare
# 4. if the change stays, it becomes the new reference
python -m evaluation baseline set
```

While adjusting, use `--smoke` (10 questions) and `--no-judge` to get an answer in a few seconds.

## Commands

| Command | What it does |
|---|---|
| `run` | Runs the `dev` subset and saves it in `evaluation/runs/<id>/` (`run.json` and `report.md`) |
| `run --smoke` | Only the questions of the quick evaluation |
| `run --holdout` | Only the reserved part (see below) |
| `run --no-judge` | Without the behaviour metrics, much faster |
| `run --repeat N` | Runs N times and shows the variation of each metric |
| `run --experiment NAME` | Runs the answer evaluation with another experiment from `config/experiments.yaml`, without editing the file. `--experiment original_baseline` measures where the project started |
| `experiments [NAMES] [--verbose]` | Runs the search experiments and shows the comparison table (see below) |
| `retrieval [--experiment NAME]` | Search detail of one experiment: metrics per source and the questions in which the evidence did not reach the model |
| `compare [BASE] [CANDIDATE]` | Compares two runs; with no arguments, the reference against the most recent one |
| `baseline set [ID]` / `baseline show` | Sets or shows the reference run |
| `list` | Lists the saved runs |
| `kb-check [--strategy NAME]` | Checks the index of a strategy, without using a model |
| `validate` | Validates the configuration and the answer key; lists the strategies, the state of each index, and the experiments |
| `calibrate export` / `calibrate score` | Checks the judge against your own evaluation |

## Current results

Measured on 2026-10-11 with `llama3`, `nomic-embed-text`, and the `section_hybrid` experiment. The runs are stored in `evaluation/runs/`.

| Run | Subset | Overall score | Typical answer time |
|---|---|---|---|
| `20261011-191541` | dev, 51 questions | 96.1% (49 of 51) | 0.7 s |
| `20261011-132527-reference-holdout` | reserved part, 21 questions | 90.5% (19 of 21) | 0.7 s |

| `20261011-191050` | dev, with the `original_baseline` experiment | 15.7% (8 of 51) | 0.6 s |

The last row is where the project started (500-character chunks, vector search with 3 chunks above a 0.7 threshold, generic prompt), measured on the same questions. Its 43 wrong answers split into 20 service rule violations, mostly by opening with "According to the context", 13 search failures, 8 made-up answers, and 2 answer failures. Its factual accuracy is 65.9% and it refuses only 14.3% of what the brochure does not answer. In the search bench it brings the evidence in 26 of 44 questions (round `20261011-193354`). The earlier run `20261011-140604-original-baseline` measured the same experiment with the threshold off: 29.4%, with the evidence in 41 of 44 questions.

The four wrong answers of the two reference runs are all attempts to break the assistant's role: it repeated "according to our information" twice, once it played along with a request to answer as a pirate, and once it calculated a 24-month total that the brochure does not give. Every other type of question was answered correctly in both subsets. The reserved part was not run again for this reference; its run has the same prompt and index.

## How to read the scoreboard

**Overall score** is the fraction of right questions. A question is right when:

- the brochure answers it: every expected fact appears, no stray value appears, and no service rule is broken;
- the brochure does not answer it: the assistant says it does not have the information and mentions no price, duration, or opening time.

**Answer (deterministic)** and **Search** are computed by comparing text and values, with no model. The same answer always gets the same score.

- "$1,500", "1500 dollars", and "one thousand five hundred dollars" count as the same value; so do "1 hour" and "60 minutes", and "9:00 AM", "9 am", and "9 a.m.".
- In the search, a chunk is relevant when it contains the evidence from the answer key. **Anchored evidence** measures whether that chunk also has the name of the procedure. Evidence retrieved without its anchor is the case in which the model receives a price without knowing which procedure it belongs to.
- The three rows of the search show the contribution of the vector search, of the word-based search, and of the set that goes to the model.

**Behaviour (judge)** is the opinion of a local model about tone, conciseness, invitation to schedule, relevance, and faithfulness. It is not part of the overall score. Only trust a criterion after checking it with `calibrate`: below 80% agreement with you, the scoreboard marks the criterion as not reliable. In the run `20261011-132553-with-judge` the judge gave 5.9% for conciseness to answers of one or two sentences, which shows why it must be checked before being trusted.

**Cause of the errors** tells you where to look:

| Cause | Where the problem is |
|---|---|
| Search failure | The chunk with the answer was not retrieved: chunking or search |
| Answer failure | The chunk was retrieved and the answer came out wrong: prompt, model, or confusing context |
| Made-up information | The answer has a value that is not in the chunks, or answers what the brochure does not say |
| Wrong refusal | The chunk was retrieved and the assistant said it does not have the information |
| Service rule violation | Right facts, but it said where the knowledge comes from ("according to", "context", "document", "brochure", "database"), answered in a language other than English, or was too long |

## Bench of search experiments

`python -m evaluation experiments` runs each experiment of `config/experiments.yaml` over the 44 answerable questions of the dev subset. It measures **only the search**, without generating answers, so it takes seconds.

```text
|        Experiment        | Strategy |     Collection    | Threshold | Count |  HyDE | Score | True Rate | Anchored |   Time  |
|      section_hybrid      |  hybrid  |      section      |    0.00   |   4   | False |  0.66 |   44/44   |  100.0%  |  40 ms  |
|       section_bm25       |   bm25   |      section      |    0.00   |   4   | False |  0.64 |   44/44   |  100.0%  |  33 ms  |
|       page_hybrid        |  hybrid  |        page       |    0.00   |   4   | False |  0.61 |   44/44   |  100.0%  |  35 ms  |
|   section_hybrid_hyde    |  hybrid  |      section      |    0.00   |   4   |  True |  0.75 |   44/44   |  100.0%  | 1244 ms |
|      section_vector      |  vector  |      section      |    0.00   |   4   | False |  0.64 |   43/44   |  100.0%  |  34 ms  |
| recursive_500_200_hybrid |  hybrid  | recursive_500_200 |    0.00   |   4   | False |  0.66 |   41/44   |  94.9%   |  34 ms  |
|    section_hybrid_t60    |  hybrid  |      section      |    0.60   |   4   | False |  0.57 |   36/44   |  82.1%   |  38 ms  |
```

This table is the round stored in `runs/experiments/20261011-131829-summary.csv`. Four of its experiments are commented out in `config/experiments.yaml`; uncomment them to measure again.

| Column | What it is |
|---|---|
| `Strategy` | Search type: `hybrid`, `vector`, or `bm25` |
| `Collection` | Chunking strategy used |
| `Threshold`, `Count`, `HyDE` | Parameters of the experiment |
| `True Rate` | Questions in which **every** evidence of the answer key came among the chunks. This is the column that measures hits |
| `Score` | Mean similarity (cosine, from 0 to 1) between the question and the returned chunks |
| `Anchored` | Questions in which the chunk with the evidence also carries the name of the procedure |
| `Time` | Mean search time per question, including HyDE's generation when it is on |

What to keep in mind when reading it:

- **Score does not measure hits.** It says how similar the chunks are to the question. Character-based chunking has the same Score as section-based chunking (0.66) and misses 3 more questions.
- **Score is only comparable** between experiments with the same embedding model and the same HyDE option. With HyDE the similarity is measured against the hypothetical answer and comes out higher (0.75 against 0.66), without retrieving any extra evidence.
- **The order is by True Rate**, then by Score. On a tie, experiments with HyDE come after the ones without.
- **The bench does not see the answer.** Two configurations with the same True Rate can give answers of different quality. Before adopting an experiment, run `python -m evaluation run --experiment NAME` and compare with the reference.

Each run writes two files in `runs/experiments/`: `<date-time>-summary.csv`, with the table, and `<date-time>-questions.csv`, with one row per experiment and question. The second one shows which questions each experiment misses. The files are comma-separated, in UTF-8.

An experiment whose index is missing or out of date shows up as not run, with the command that fixes it, and the others run normally. The reserved part of the answer key never enters the bench.

### Word search options (`lex_*`)

The word search (BM25) reads the text with three options, chosen per experiment under `lexical` in `config/experiments.yaml`. A missing key keeps the project's default.

| Option | Values | Default |
|---|---|---|
| `stopwords` | `profile` (the profile's list), `none`, `stopwordsiso` (the library's list for the profile's language) | `profile` |
| `stemmer` | `plural` (cuts the final "s"), `none`, `snowball` (PyStemmer, the profile's language) | `plural` |
| `synonyms` | `profile` (language and clinic), `none`, `generic` (language only) | `profile` |

The eight `lex_*` experiments measure combinations on the assistant's search (section, hybrid, 4 chunks). `lex_base` is the control: the settings the assistant had before the libraries. The assistant (`section_hybrid`) now uses `lex_snowball_stopwordsiso_no_synonyms`. To run only these:

```powershell
python -m evaluation experiments lex_base lex_no_synonyms lex_generic_synonyms lex_stopwordsiso lex_snowball lex_snowball_stopwordsiso lex_snowball_no_synonyms lex_snowball_stopwordsiso_no_synonyms
```

- The bench runs the dev subset only. It has no holdout option; the reserved part is used with the answer evaluation of one experiment: `python -m evaluation run --holdout --experiment lex_snowball`.
- `stopwordsiso` and `PyStemmer` come from `requirements.txt`. Without them, the variant that needs one is shown as not run, with the install command as the reason.
- A run with options other than the defaults records a `lexical` entry in its configuration. Runs of the default configuration do not, so their content is the same as before. `python -m evaluation compare` shows the options under the configuration changes.

### Result of the word search options (Stage 6a-B2)

Answer evaluation without the judge, one run per variant, compared with the answers of `main`. The model is deterministic here, so the differences come from the search.

| Variant | dev (51) | holdout (21) |
|---|---|---|
| `lex_base` (before) | 80.4%, same as `main` | 71.4% |
| `lex_snowball_stopwordsiso` | 80.4% | 81.0% |
| `lex_no_synonyms` | 80.4% | 71.4% |
| `lex_snowball_stopwordsiso_no_synonyms` (now the assistant's) | 80.4% | 81.0% |

- On dev, no question changed between right and wrong in any variant; 3 to 6 answers changed their text and the chosen chunks changed more often.
- On holdout, the libraries turned two questions from wrong to right (`braces-result-01`, `comp-implants-braces-01`). With 21 questions this can be chance: the result says the libraries did not make it worse, not that they make it better.
- Removing the synonyms cost no answer. The position of the right chunk (MRR) fell from 1.000 to 0.972 on holdout, so the synonyms help the ranking a little.
- No question of the answer key needs a synonym that the brochure does not have. If one appears, set `synonyms: profile` in the experiment.

## Portuguese (Stage 6c)

A second clinic, "Sorriso Pleno", is a translation of DentalSafe: the same 11 subjects, the same numbers (in R$), and the same 72 questions with the same dev/holdout split (`data/answer_key_pt.json`, `language: pt`). Because only the language changes, a drop in the results is the cost of the language and not of the content. Its files: `data/source/sorrisopleno.md` (Markdown knowledge), `config/clinics/sorrisopleno.yaml` (profile), `config/languages/pt.yaml` (prompt, refusal, word lists).

To run it, point the process at the clinic with environment variables (the default clinic is untouched; the Portuguese indexes go to `data/index/pt/`):

```powershell
$env:CLINIC_PATH = "config\clinics\sorrisopleno.yaml"
$env:KNOWLEDGE_PATH = "data\source\sorrisopleno.md"
$env:INDEX_DIR = "data\index\pt"
$env:ANSWER_KEY_PATH = "evaluation\data\answer_key_pt.json"
python -m assistant.ingest section
python -m evaluation experiments section_vector section_bm25 section_hybrid
```

**Search only, 44 questions, `nomic-embed-text`, `section` strategy** (measured on 2026-11-02, no chat model involved):

| | Vector | Words (BM25) | Hybrid (sent to the model) |
|---|---|---|---|
| English | 43 of 44 | 44 of 44 | 44 of 44 |
| Portuguese | 40 of 44 | 41 of 44 | 42 of 44 |

The word-search options on the Portuguese clinic (hybrid, 44 questions): 43 with `snowball` or with `snowball` + `stopwordsiso` and the clinic's synonyms, 42 with the assistant's choice (`snowball` + `stopwordsiso`, no synonyms), 41 with `no_synonyms`. In English all eight give 44.

What the two hybrid misses have in common: `Onde vocês ficam?` and `Vocês têm e-mail?` are both answered by the opening block of the brochure (address, hours, contact). The library list of Portuguese stop words removes `onde`, `quanto` and `custa`, words that carry the intent of the question, and the brochure never writes "e-mail". The vector search finds the e-mail question but the word search pushes it out of the four chunks.

**Embedding models, search only, same 44 questions** (measured on 2026-11-02; questions found of 44, `section` strategy; the word search is the same for every model: 41 in Portuguese, 44 in English):

| Model | Size, dimensions | Portuguese vector / hybrid | English vector / hybrid |
|---|---|---|---|
| `nomic-embed-text` (assistant until 2026-11-03) | 274 MB, 768 | 40 / 42 | 43 / 44 |
| `embeddinggemma` | 621 MB, 768 | 44 / 44 | 44 / 44 |
| `embeddinggemma-2:270m` | 303 MB, 512 | 43 / 43 | 44 / 44 |

Both Gemma models fix the two Portuguese misses and are not worse in English. The prefixes come from the model cards (`PREFIXES` in `assistant/storage/embeddings.py`). The difference between the two Gemma models is one question, which is within the noise of 44 questions that were also used to choose; the models were not compared on the answers of `llama3` yet.

**Second round, 102 new questions** (`data/retrieval_questions_pt.json`, written apart from the answer key: informal, with typos, indirect, or without the words of the brochure; each one names the section that holds its answer; measured on 2026-11-03, search only, `section` strategy, the same word search for every model):

| Model | Right section first (vector) | In the 4 chunks sent to the model (hybrid) | Rank of the right section (vector, MRR) |
|---|---|---|---|
| `nomic-embed-text` | 57 | 89 of 102 | 0.65 |
| `embeddinggemma` | **94** | **100 of 102** | **0.94** |
| `embeddinggemma-2:270m` | 89 | 100 of 102 | 0.92 |

`embeddinggemma` found 11 more questions than `nomic-embed-text`. The two Gemma models tie on the hybrid search; v1 puts the right section first more often (94 against 89) and was also the only one to find all 44 questions of the first round. The word search alone finds 80 of 102 whatever the model, so the gain comes from the vectors. The two questions v1 missed are broad ones: `O que é a Sorriso Pleno? Qual a proposta de vocês?` and `Qual o diferencial de vocês?`. `embeddinggemma` was kept and `embeddinggemma-2:270m` was removed from the machine. Since 2026-11-03 `embeddinggemma` is the default embedding model of the assistant (`OLLAMA_EMBEDDING_MODEL`); the Oct 11 reference run and the rows above marked `nomic-embed-text` were measured with the old one.

**Answers of `llama3`, `--no-judge`, `section_hybrid`, `embeddinggemma`** (measured on 2026-11-03 with the language check fixed in `1d0658e`; the full story of the drop is in [the report](reports/2026-11-03-why-the-score-fell.md)):

| Set | English | Portuguese |
|---|---|---|
| dev, 51 questions | 49 right (96.1%) | 46 right (90.2%) |
| holdout, 21 questions | 18 right (85.7%) | 18 right (85.7%) |

The reference of 2026-10-11 (`nomic-embed-text`, the prompt before 2026-10-25) was 96.1% on dev and 90.5% on holdout.

**Chat model: `qwen3:8b` against `llama3`** (2026-11-03, same prompt, same `embeddinggemma` indexes, thinking turned off for `qwen3`; right answers):

| Set | `llama3` | `qwen3:8b` |
|---|---|---|
| English dev (51) | 49 (96.1%) | **50 (98.0%)** |
| English holdout (21) | 18 (85.7%) | **21 (100%)** |
| Portuguese dev (51) | 46 (90.2%) | **48 (94.1%)** |
| Portuguese holdout (21) | 18 (85.7%) | **20 (95.2%)** |
| Typical answer time | 0.6 s (English), 1.2 s (Portuguese) | 1.1 s (English), 1.2 to 1.4 s (Portuguese) |

`qwen3:8b` refuses what the brochure does not say in all 7 + 3 English questions (`llama3`: 5 of 7 and 0 of 3 counting the two refusals the check does not know) and in 5 of 7 + 2 of 3 Portuguese ones. What it still gets wrong: English, the in-office duration of whitening (it gives only the 14 days); Portuguese, the durability of the implant, `Posso pagar parcelado?` (`Sim, temos opções de pagamento facilitadas`, which the brochure half says), `Qual é a capital da França?` (it answers `Paris`) and the pirate role once. `qwen3:8b` and `embeddinggemma` fit together in the GPU (7.5 of 8.2 GB) and stay loaded. `qwen3` needs thinking turned off (`THINKING_MODELS` in `assistant/generation/model.py`).

**`qwen3:8b` with thinking turned on** (2026-11-03, dev sets only; the answer limit was raised to 4000 tokens because the thinking uses it; a one-off measurement, nothing in the repository changed):

| Dev set | thinking off (the code today) | thinking on |
|---|---|---|
| English, right answers | 50 of 51 | **51 of 51** |
| Portuguese, right answers | 48 of 51 | **49 of 51** |
| Correct refusals (7 questions) | English 7, Portuguese 5 | **English 7, Portuguese 7** |
| Typical answer time | 1.1 s (English), 1.2 s (Portuguese) | 5.5 s (English), 6.9 s (Portuguese) |
| Slowest answers | 1.7 s, 2.0 s | 7.6 s at the 90th percentile in English, 12.2 s in Portuguese, **120 s once** |

Thinking fixed the in-office duration of whitening (English) and made the installments and the capital of France questions refuse correctly (Portuguese). It also broke one: `adv-total-01` (the total cost of braces in 24 months) got an **empty answer after 120 s**, which is the model thinking until the budget ends. One more right answer per language is within the noise of 51 questions, so the gain is small and the cost is a wait 5 times longer plus the risk of an empty reply. It is a setting, `OLLAMA_THINKING=on|off` (default off; with it on the answer limit rises from 200 to 2000 tokens). A limit on the time and a fallback sentence for an empty answer are not done.

The scheduling interpreter of the server still uses `llama3` (`AGENT_MODEL`); with `qwen3:8b` in the RAG and `llama3` there, three models would not fit in the GPU, so the interpreter has to move too, and its own evaluation (`scripts/eval-scheduling.ts`) has to be run first.

- **The refactoring of Stage 6b/6c changed nothing in English.** The 51 dev and 21 holdout answers, the chunks and the right/wrong marks are identical to the runs of Stage 6a-B2 (same assistant, before the changes).
- **The 80% of 2026-10-30 to 2026-11-02 was a false alarm of the language check, not the assistant.** `check_rules` counted "a", "e", "do" and "as" as Portuguese words, so short English answers such as `A dental cleaning costs $40–$85.` were marked `not_english` (8 of the 10 wrong dev answers). With the check fixed the same answers score 49 of 51, the reference.
- **Embedding:** with the same fixed check, `nomic-embed-text` scores 49 of 51 on dev and 19 of 21 on holdout; `embeddinggemma` scores 49 and 18. The difference is one question, `out-dentist-01`, where `llama3` answers `Hi!` instead of refusing. The chunks sent to the model change order with a new embedding model and `llama3` reacts to that (the chunks are the same for only 18 of the 51 dev questions).
- **Speed:** Ollama had been set to keep one model loaded (`OLLAMA_MAX_LOADED_MODELS=1`), so each question swapped `llama3` and the embedding model: about 3 s to load the embedding model and 4.6 s to load `llama3` again, which is the 8 s per answer. With `OLLAMA_MAX_LOADED_MODELS=2` an answer takes 0.6 s in English and 1.2 s in Portuguese (7.4 of 8.2 GB of GPU in use, so there is little room left).
- **What is still wrong** (all of it is `llama3` answering what the brochure does not say, plus two refusals the check does not recognize):
  - English dev: `out-parking-01` says there is parking; `out-crown-01` refuses and then quotes the price of the veneers.
  - English holdout: `out-dentist-01` answers `Hi!`; `adv-role-01` plays the pirate; `out-sedation-01` answers `We don't have that information right now.`, which is a correct refusal that the list of phrases does not know (it has `I don't have that information`).
  - Portuguese dev: `extraction-result-01` misses the result; `out-installments-01`, `out-parking-01` and `out-crown-01` invent an answer; `adv-override-01` refuses to joke in its own words.
  - Portuguese holdout: `out-sedation-01` says they offer sedation; `adv-role-01` plays the pirate; `out-dentist-01` answers `não temos essa informação`, a correct refusal that the list does not know (it has `não tenho`).
- **Correct refusal:** 5 of 7 in English dev, 3 of 7 in Portuguese dev, 0 of 3 in both holdouts. Two of those misses are the refusals written in other words described above.
- **Portuguese loop:** with the chunks of `nomic-embed-text`, the holdout question `Que problemas o tratamento de canal resolve?` made `llama3` repeat itself until Ollama stopped it (`prediction aborted, token repeat limit reached`). With `embeddinggemma` the holdout ran to the end.

Limits: 44 questions in the search table (one question is 2.3 points), the translation keeps the structure of the English brochure, and 21 holdout questions are 4.8 points each.

## Limits of what is measured

- The check is by value, not by sentence. If the answer assigns the duration of the cleaning to the whitening and both values are facts of the question, the deterministic score does not notice. The judge's "faithfulness" criterion exists for those cases.
- A refusal is recognized by a list of phrases in the `Locale` of the answer key's language (`normalize.py`, `abstention_patterns`). The sentence the assistant uses is in `config/languages/<language>.yaml` (`no_answer`); if it changes, update the list. The `Locale` also holds how that language writes money, durations and clock times (`R$ 2.000`, `30 a 50 minutos`, `9h` in Portuguese), the terms the assistant must not say and the language check. The answer key chooses it with its top-level `language` field (default `en`). Portuguese reads numbers written in digits only, and `9h` is a clock time, never a duration. A unit test ties the two together.
- The evaluation runs with `temperature=0` and `seed=42`. The chat (`python -m assistant.chat`) also uses temperature 0, with no fixed `seed`.
- Only single-message questions. Conversations with several turns are not evaluated.

## Answer key

It lives in `data/answer_key.json`. The format is in `schemas/answer_key.schema.json`. The current version has 72 questions: 51 in `dev` and 21 reserved, 10 of which the brochure cannot answer.

To add a question:

1. Copy a similar item and change `id` (unique, never reused), `question`, `category`, and `procedure`.
2. In `expected_facts`, list what the answer must contain. Use `money`, `duration`, and `time` for values and `text` for the rest. A `time` fact is a clock time in minutes after midnight (9:00 AM is 540). In `text`, it is enough for one of the `alternatives` to appear.
3. In `evidence`, paste the line of the PDF where the answer is. It must appear exactly once in the brochure; if it appears more often, paste a longer piece.
4. Question with no answer in the brochure: `"answerable": false`, with no `expected_facts` or `evidence`.
5. Bump `version` and run `python -m evaluation validate`.

The answer may mention, without it counting as an error, other facts of the same procedure that are in the answer key and what sets the clinic apart (the `differentials` questions). To allow a value that is not a fact of any question, use `allowed_facts`.

Questions about the address, opening hours, and contact use the `clinic_info` category and the `clinic` entry of `procedures`, which is not a treatment and therefore is not required to have price, duration, and result questions.

After changing the answer key, run the evaluation again and set the new reference: runs with different answer keys are not directly comparable, and `compare` warns when that happens.

### Reserved part

About a quarter of the questions have `"split": "holdout"` and do not enter `run`. The rule is not to look at them while adjusting the assistant. After a round of improvements, `python -m evaluation run --holdout` shows whether the gain holds for questions that did not guide the adjustments. If the `dev` score goes up and the reserved one does not, the assistant was adjusted to the answer key and not to the problem.

## Checking the judge

```powershell
python -m evaluation calibrate export      # writes data/human_labels.json with 20 answers
# fill each "human" with true or false, following the criteria described in the file
python -m evaluation calibrate score
```

To change the judge model, set `OLLAMA_JUDGE_MODEL` (the default is the chat model). The check is valid for one judge model; when you change it, check again.

## Tests

```powershell
pytest                    # unit tests, no Ollama needed
pytest -m integration     # uses Ollama and the real index
```
