# Architecture decision records

Decisions someone might question or want to reverse. Most come from the `research.md` of each feature spec (in Portuguese), where the full reasoning and alternatives are. `Reconstructed` means the record was written afterwards from the code and docs.

| # | Decision | Status |
|---|---|---|
| [0001](0001-reuse-raglab-as-separate-service.md) | Reuse RagLab as a separate Python service | Accepted |
| [0002](0002-state-machine-with-local-llm-as-interpreter.md) | Deterministic state machine; the local LLM only interprets | Accepted |
| [0003](0003-single-send-gate.md) | One gate for every outgoing WhatsApp message | Accepted |
| [0004](0004-evolution-api-unofficial-whatsapp.md) | Unofficial WhatsApp connection through the Evolution API | Reconstructed |
| [0005](0005-google-calendar-source-of-truth.md) | Google Calendar as the source of truth | Accepted |
| [0006](0006-appointment-belongs-to-phone.md) | The appointment belongs to the phone, with one booking engine | Accepted |
| [0007](0007-single-process-in-memory-coordination.md) | Single process with in-memory coordination | Reconstructed |
| [0008](0008-reminder-only-inside-24h-window.md) | Reminders only inside the 24 h window | Accepted |
| [0009](0009-rag-composition-root.md) | One composition root for the RAG service, with injected providers | Accepted |
| [0010](0010-multi-clinic-and-knowledge-table.md) | Many clinics, with each clinic's knowledge in a table | Proposed |
| [0013](0013-reminders-outside-the-24h-window.md) | Reminders may go out even when the patient has been silent for more than 24 h | Accepted |
| [0011](0011-grounded-answers-measured-not-adopted.md) | Grounded answers: built, measured, off by default | Accepted |
| [0012](0012-node-server-toward-many-clinics.md) | The Node server toward many clinics: one clinic context first, the tenant key later | Proposed |
| [0014](0014-booking-services-are-the-clinics-treatments.md) | Booking services are the clinic's treatments from the knowledge table, stored by key | Accepted |
| [0015](0015-appointment-length-per-treatment-and-time-grid.md) | Appointment length per treatment and a 15-minute time grid | Accepted |
| [0016](0016-one-language-setting-for-the-bot-and-the-panel.md) | One language setting for the bot and the panel, panel translated with react-i18next | Proposed |

New decision → new file `NNNN-short-title.md` with Status, Date, Context, Decision, Alternatives, Consequences. Don't rewrite an old record; mark it `Superseded by NNNN`.
