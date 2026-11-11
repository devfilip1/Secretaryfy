# 0017 · Facts of the message are read by focused extractors, merged in code

**Status:** Accepted · **Date:** 2026-11-09

## Context
The interpreter asked the local model for one JSON object per message: intent, option, date, time, name and urgency. The state machine trusted every field. Four misreadings came from that trust, each fixed by a small `if` in the router:
1. "de manhã" (a part of the day) was taken as a clock time.
2. A date was filled for a message that names no day: "e à noite, tem?" got a Saturday.
3. A time was invented when the message named none.
4. "the first one" was read as a day, not as position 1 of the list on screen.

Each fix added a rule next to the previous ones, and the router grew a branch per model field. Adding a `period` field to the main schema was tried and regressed the eval: the model filled the new field with guesses.

## Decision
1. **Each fact the message states is read by its own focused extractor.** Time, part of the day, whether the message names a day, and the chosen option position each have a short prompt and a small schema. The answer carries a **quote** from the message, and the code checks that the quote is in the message (after normalizing case and accents). An answer without a checked quote counts as no answer.
2. **Pure merge functions decide, with explicit precedence.** They live in `src/modules/scheduling/understanding/resolve.ts` (`wantsWhen`, `applyWhen`, `needsPick`, `applyPick`). A period beats a time the model invented. A focused call that ran beats the main model's time field. A date the message does not name is dropped. With slots on screen, a time or part of the day is a choice inside the day on screen. With options on screen and none read, a position is asked.
3. **The flow trusts only the merged result.** It never reads a raw model field it cannot verify.
4. **Each extractor has a phrase list in one place:** `scripts/eval-extractors.ts`. A new misreading is a new phrase there, and a case in the table test, not a new `if` in the router.
5. **The main interpreter schema is not widened.** Facts that need a focused read stay out of it.

A message the main interpreter reads as `rude`, `manipulation` or `off_topic` gets one more focused call, `mentionedSense`, which answers whether the words are random and make no request, statement or insult. Pure gibberish is downgraded to `unclear`, so the booking flow repeats its question instead of answering with the refusal or the empathy text. The call can only downgrade: it never raises an intent or touches other intents, and when it fails the intent stays as the main interpreter gave it. The main interpreter prompt does not change.

## Alternatives considered
- **Trust the main model's fields and add one `if` per bug:** this is how the four misreadings were patched, and each patch sits in the router where the next one lands.
- **Add `period` (and more) to the main schema:** the model filled the new field with guesses and the eval regressed.
- **Regex or keyword lists in code:** forbidden by `CLAUDE.md` (no keyword lists in code; the model reads the wording through an enum in its schema).

## Consequences
- Booking, availability, reschedule and choice messages make one extra short model call, about 0.5 s each.
- Each new misreading is a phrase in `scripts/eval-extractors.ts` and a case in the table test. The router does not change.
- The extractors have no memory of the conversation, so a fact that needs context is still the main interpreter's job, and the merge decides which of the two to believe.
- Known limitation, not in the table: "the earliest" and "o mais cedo" still read as no option.
