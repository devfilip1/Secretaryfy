# 0014 · Booking services are the clinic's treatments from the knowledge table, stored by key

**Status:** Accepted · **Date:** 2026-11-05

## Context
The services a patient can book were a list in code (`scheduling/services.ts`): the eight brochure treatments with their English names, a Portuguese label and two lists of keywords each. The code read the patient's words to pick one (`detect`), and the English name was what `appointments.service` stored. A new treatment meant a code change, and the words lists were a second copy of the clinic's data that the owner does not want to keep. [ADR 0012](0012-node-server-toward-many-clinics.md) (step 4) asks for the service catalog to belong to the clinic, with a stable key stored instead of the English name.

## Decision
1. **The bookable services are the clinic's treatments.** A treatment of the knowledge table (`knowledge_sections`, kind `treatment`) can be booked unless its data says `bookable: false`, which keeps it information-only. The general assessment is always present, last in the list.
2. **The stored service is the treatment's key** (the stable slug of the section). The assessment stores `Assessment`. The label the patient reads is the treatment's title.
3. **The model picks the service from the list.** The interpreter's JSON schema has `service` as an enum of the catalog labels (in the clinic's language, plus null). The model returns it with any intent where it applies, and `byLabel` maps the label back to the key. No keyword list exists in code; `byLabel` is an exact match on a label or a name after removing accents and case, with no fuzzy matching. A bare number at the choice step still reads through the list (`byNumber`).
4. **The catalog is a snapshot.** `createKnowledgeCatalog` keeps the list in memory so its methods stay synchronous. It is refreshed at boot and after every create, update, delete or reorder in the panel (`onChange`). The server is a single process ([ADR 0007](0007-single-process-in-memory-coordination.md)), so one snapshot is enough.
5. **Labels in code are the assessment's only.** Its label per language ("General assessment", "Avaliação geral") is the one text the code keeps; treatment labels are the clinic's own words.

## Alternatives considered
- **Keep the keyword lists, one per clinic:** the lists would be the second copy of the clinic's data, and each new treatment would need a code change.
- **Let the model read the free text of the brochure:** the choice would be a guess with no closed list to check against; the enum keeps the answer inside the clinic's treatments.
- **Store the English name still, with the label from the table:** keeps existing rows as they are, but ties the key to a title the clinic may change.

## Consequences
- Existing test appointments store English names (`Dental Cleaning`). They are not migrated: they keep their name, which the catalog shows as its own label when the name is not in the table.
- Google Calendar titles and the history notes show the stored name, so a booking made from now on shows the treatment's key (e.g. `limpeza-dental`) in the event title and in the history, not the title. Showing the title there needs the catalog in `booking.ts` and the panel's rename of events, a follow-up for the owner.
- Renaming a key after bookings were made leaves those bookings with the old key (the event title keeps the old text too). Titles can change freely; keys should not.
- The enum grows with the treatments: the schema sent to Ollama has one more entry per bookable treatment. With 20 or more, the prompt is bigger; the real-model evaluation (`scripts/eval-interpret.ts`) should be run after any large change to the list.
- A treatment mentioned earlier in the conversation is picked by the model, which reads the recent history; the server no longer scans the messages for a keyword.
