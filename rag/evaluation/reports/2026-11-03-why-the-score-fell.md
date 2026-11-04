# Why the English score fell from 96% to 80%, and why the assistant was not the cause

Written on 2026-11-03 after the investigation of Stage 6c. The fix is commit `1d0658e`.

## Short version

- The reference of 2026-10-11 scored **96.1%** on the dev questions (49 of 51) and **90.5%** on the holdout (19 of 21). From 2026-10-30 on, every run scored **80.4%** (41 of 51) and nobody asked why.
- The drop was **not** a worse assistant. **Eight of the ten wrong dev answers were a false alarm of the language check**: it counted the word "a" as Portuguese, so a short English answer such as `A dental cleaning costs $40–$85.` was marked "not English".
- With the check fixed, the same stored answers score **49 of 51 (96.1%)** on dev, exactly the reference. The refactoring of Stages 6a to 6c did not change a single English answer.
- Two other things were found on the way: the prompt had been rewritten on 2026-10-25 and never measured against the reference, and answers took 8 s instead of 0.7 s because Ollama was set to keep one model in memory.

## What we saw

| Run | Date | Dev | Holdout | Answer time | Note |
|---|---|---|---|---|---|
| Reference (RagLab) | 2026-10-11 | 49 of 51 (96.1%) | 19 of 21 (90.5%) | 0.7 s | old prompt, `prompt_hash 3255edbf…` |
| `main` control | 2026-10-30 | 41 of 51 (80.4%) | - | 6.4 s | new prompt, `prompt_hash 8ec20153…` |
| Stage 6a-B2 runs | 2026-11-01 | 41 of 51 | 17 of 21 | ~8 s | same as the control |
| Stage 6b/6c, `nomic-embed-text` | 2026-11-02 | 41 of 51 | 17 of 21 | 8 s | same answers as the B2 runs |
| Stage 6b/6c, `embeddinggemma` | 2026-11-03 | 41 of 51 | 15 of 21 | 0.6 s | |

Every run since 2026-10-30 printed `Overall score 96.1% → 80.4%, worse` in its comparison table. It was read as "the state of the environment" and not investigated. That was the mistake: the table also showed that the `prompt_hash` of the reference was different.

## Investigation

1. **The refactoring is innocent.** Comparing the Stage 6b/6c English runs with the Stage 6a-B2 runs (same assistant, before the refactoring): the 51 dev answers, the 21 holdout answers, the chunks sent to the model and the right/wrong marks are identical. The Markdown source gives the same chunks and the same search result as the PDF.
2. **The speed was a configuration.** `OLLAMA_MAX_LOADED_MODELS=1` was set for the user. Each question loaded the embedding model (about 3 s, evicting `llama3`) and then `llama3` again (4.6 s). With the value 2 an answer takes 0.6 s. It does not explain the score: the answers are the same at either speed. We do not know since when the variable was 1.
3. **Where the score was lost.** Of the 10 wrong dev answers, 8 had the rule violation `not_english`, 1 had `according to` and 1 was an invented answer (parking). The answers flagged as not English were correct and in English, for example:
   - `A dental cleaning costs $40–$85.`
   - `A complete smile transformation`
4. **Why they were flagged.** `check_rules` counts common words of each language and flags the answer when the Portuguese list wins. The Portuguese list had `a`, `e`, `do` and `as`, which are also English (`a`, `e-mail`, `do you`, `as`). A short answer with `a` and none of the 14 English words in the list had 1 against 0. The check came from the RagLab and was copied without review.
5. **Why it started in October.** `d5145c3` (2026-10-25, the commit that added the WhatsApp `splitReply`) rewrote the prompt: short natural messages split in 1 to 3 parts, no invitation to schedule in every answer, a greeting only in the first message. Compared with the prompt of the first copy (`ad7a8ea`, identical to the reference), answers got shorter, so more of them had too few words to escape the false alarm. The reference was never measured again with the new prompt.

## Result with the check fixed

The stored answers were scored again with the corrected check (no new model call), and then the evaluations were run again to store the new marks:

| Set | Embedding | Before | After the fix |
|---|---|---|---|
| dev | `nomic-embed-text` | 41 of 51 | **49 of 51 (96.1%)** |
| dev | `embeddinggemma` | 41 of 51 | **49 of 51 (96.1%)** |
| holdout | `nomic-embed-text` | 17 of 21 | **19 of 21 (90.5%)** |
| holdout | `embeddinggemma` | 15 of 21 | **18 of 21 (85.7%)** |

The prompt of 2026-10-25 did not cost anything on the dev set. Most wrong answers that remain are real (`llama3` answers what the brochure does not say), but one is a second weakness of the check, described below.

| Set | Still wrong | What happened |
|---|---|---|
| dev | `out-parking-01` | says there is parking |
| dev | `adv-wrong-price-01` (`nomic`) | writes "according to our information" |
| dev | `out-crown-01` (`embeddinggemma`) | adds veneers to a refusal |
| holdout | `adv-role-01` | plays the pirate |
| holdout | `out-sedation-01` | answers `We don't have that information right now.`, a correct refusal the list of phrases does not know (it has `I don't have that information`) |
| holdout | `out-dentist-01` (`embeddinggemma`) | answers `Hi!` instead of refusing |

## A second, smaller weakness: the refusal phrases

The check recognizes a refusal by a list of phrases (`abstention_patterns` in the `Locale`). The list has `i don't have that information` and, in Portuguese, `nao tenho essa informacao`. The model sometimes refuses in other words and is marked as inventing an answer:

- English holdout, `out-sedation-01`: `We don't have that information right now. I can help you with our treatments…`
- Portuguese holdout, `out-dentist-01`: `Infelizmente, não temos essa informação. No entanto, posso ajudar com nossos tratamentos…`

Both are correct refusals. Counted as such, the English holdout scores 19 of 21 and the Portuguese holdout 19 of 21. This is not fixed yet.

## What was changed

- `1d0658e`: the common words of both languages left the Portuguese list, and a language is flagged only with at least 2 words of the other one. Tests cover short English and Portuguese answers.
- The README of the evaluation has the new numbers and the list of what is still wrong.

## What would prevent it next time

1. **Check the language only where it is the point of the question.** The assistant of a clinic answers in the language of the clinic, and the prompt already says so. The one case worth checking is a question written in another language (`adv-english-01` in the Portuguese key). A field on those questions (`expected_language`) would remove the false alarms of every other answer.
2. **Use a real detector, not word lists, when the check is needed.** A small language identification library is correct on short texts where a list of 14 words is not.
3. **Refresh the reference when the prompt changes.** A comparison against a run with another `prompt_hash` is not a measure of the code. The scoreboard should say so in red.
4. **Do not accept "worse" as the normal state.** A drop of 15 points that repeats in every run is a finding.
5. **Write down the Ollama setting.** `OLLAMA_MAX_LOADED_MODELS=2` is needed with a chat model and an embedding model, and the GPU has to have room for both (7.4 of 8.2 GB used today).

## Open

- Widen the refusal phrases (`We don't have…`, `não temos…`) or, better, recognize a refusal by the sentence the assistant is told to use plus the sentences that follow the same pattern.

- Portuguese is a different problem and is measured in the README of the evaluation: `llama3` refuses only 2 of 7 unanswerable questions and loops on one holdout question.
- Done on 2026-11-03: the reference in `runs/baseline.json` is now a run with the current prompt, `embeddinggemma` and the language check on `expected_language`: dev 49 of 51 (96.1%), holdout 19 of 21 (90.5%).
