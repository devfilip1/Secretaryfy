# Product

## Problem and proposal

Small clinics answer patients on WhatsApp by hand: the same questions about prices and treatments, back-and-forth to find a free time, and patients who forget their appointment. Secretaryfy puts an assistant on the clinic's own WhatsApp number that answers from the clinic's material, books straight into the clinic's Google Calendar and reminds patients the day before. Staff keep full control from a web panel.

Two things set it apart:
- **It runs on a small local model.** `llama3` 8B (4-bit) runs on the clinic's machine through Ollama, with no paid API and no conversation leaving the machine. Reliability comes from the design: rules and code do the deciding, and the model only interprets ([ADR 0002](decisions/0002-state-machine-with-local-llm-as-interpreter.md)).
- **It protects the number.** It connects like WhatsApp Web (QR code), not through Meta's official platform, so every message passes an anti-ban gate that imitates human pacing and refuses risky sends ([business rules](business-rules.md#anti-ban-protection)).

## User roles

| Role | What they do |
|---|---|
| Patient (customer) | Talks to the clinic on WhatsApp: asks questions, books, reschedules, cancels, confirms reminders. Never sees the panel. |
| Operator (clinic staff) | Uses the web panel with a single shared password: connects the number and the calendar, follows and answers conversations, books for patients who called, manages the customer registry. |

There is one operator account and no per-user permissions.

## Features

- **Assistant on WhatsApp**
  - Answers questions from the clinic's brochure, in up to 3 short messages, like someone typing. Says it doesn't know instead of inventing. See [RAG service](integrations.md#rag-service).
  - Books an appointment: offers days, then times (numbered options), asks for the name and the service, shows a summary and books only after "yes". Rules: [scheduling](business-rules.md#scheduling).
  - Shows, reschedules and cancels the patient's upcoming appointment.
  - Asks the patient's name once and remembers it ([names and customers](business-rules.md#names-and-customer-registry)).
  - Sends a reminder 24 h before; YES confirms, NO leads to rescheduling ([reminders](business-rules.md#reminders)).
  - Hands over to staff after 2 messages it can't understand.
  - Stops writing to anyone who says "stop" ([opt-out](business-rules.md#br-ab-05--opt-out-and-opt-in)).
- **Web panel** (English, works on phones)
  - **Conversations:** live list with search, unread counts and previews; full history labelled by sender (patient, assistant, operator, phone, system notes). The operator replies from the browser, which pauses the assistant in that conversation until "Resume".
  - **Appointments:** today, tomorrow and the next 7 days, with name, service, phone, notes and reminder status. Confirm by hand, open the conversation, or book a new appointment for a patient who called.
  - **Connection:** WhatsApp status and QR code to pair the number.
  - **Calendar:** connect Google Calendar, pick the calendar and set opening hours and booking rules.
  - **Customers:** registry of everyone who booked, with search, name editing, private notes, link to the conversation and deletion.
  - **Protection banner:** shows warm-up or automatic pause of the anti-ban gate.

## Main journeys

**1. A patient books on WhatsApp**
1. "Hi, how much is a cleaning?" → the brochure answers, and the assistant asks the patient's name (once).
2. "I'd like to book one" → the assistant lists up to 6 days with free times.
3. The patient picks a day, then a time.
4. The assistant shows a summary (day, time, name, service: Dental Cleaning) and asks for "yes".
5. "yes" → the calendar is checked again, the event "Maria — Dental Cleaning" is created, the patient joins the customer registry and a 📅 note appears in the panel history.

**2. The reminder**
1. The day before, if the patient wrote to the clinic in the last 24 h, the assistant sends "…Please reply YES to confirm."
2. YES → appointment confirmed (shown in the panel). NO → the assistant offers to reschedule.
3. If the patient hasn't written in 24 h, nothing is sent: the appointment shows **Remind manually** and staff call and click **Confirm**.

**3. A patient phones the clinic**
1. Staff open **Appointments → New appointment** and type the phone in any format.
2. The panel looks up the name, lists only free days and times (same calculation as the assistant) and books.
3. The patient gets no message. If they later write on WhatsApp, the assistant finds the appointment by phone.

## Out of scope and known limitations

- Only text messages are answered. Audio, images and other media are stored and shown, but not answered. Group chats are ignored.
- The assistant answers only in English. Questions in Portuguese can retrieve the wrong brochure section, because the search synonyms are English.
- One clinic, one WhatsApp number, one Google Calendar, one operator password per deployment.
- The unofficial WhatsApp connection always carries some ban risk. The gate reduces it but cannot remove it; only Meta's official platform can.
- The assistant never writes first: no marketing, no reminders to patients outside the 24 h window ([ADR 0008](decisions/0008-reminder-only-inside-24h-window.md)).
- History starts when the number is connected; older phone chats are not imported. Disconnecting the number deletes all conversations (appointments and customers stay).

## Glossary

| Term | Meaning | In the code |
|---|---|---|
| Brochure | The clinic's PDF (treatments, prices, hours) the RAG answers from | `rag/data/source/DentalSafe.pdf` |
| Conversation | All messages with one phone number | `conversations` |
| Origin | Who wrote a message: customer, assistant, operator (panel), phone (the clinic's own phone app) or system (internal note, never sent) | `messageOrigin` |
| Customer | A patient in the registry: everyone who confirmed a booking | `customers` |
| Known name | The name the patient said in the chat, or else the registry name. The WhatsApp profile name never counts. | `inbox.knownName` |
| Service | What the appointment is for: one of 8 brochure treatments or `Assessment` ("not sure") | `scheduling/services.ts` |
| Scheduling session | A booking/cancel/reschedule dialogue in progress, with its current step and the numbered options offered | `scheduling_sessions` |
| Rules (booking rules) | Opening hours per weekday, appointment length, minimum notice, days ahead, cancellation notice | `scheduling_rules` |
| Gate | The anti-ban checkpoint every outgoing message passes | `antiban/gate.ts` |
| 24 h window | The 24 h after the patient's last message; the assistant may only write inside it | rule `outside_window` |
| Opt-out | The patient asked not to receive messages | `contact_preferences` |
| Warm-up | Lower limits during a newly connected number's first 14 days | `antiban/limits.ts` |
| Breaker | Automatic pause of all automated sends after repeated failures or connection drops | `antiban/breaker.ts`, `protection_state` |
| Needs attention | A conversation flagged for staff (assistant gave up, loop, limit reached) | `conversations.needs_attention` |
| Paused (conversation) | The assistant stays silent in that conversation until the operator resumes it | `conversations.assistant_paused` |
| Remind manually | Panel label: the reminder can't be sent automatically, so staff should call | `reminders/status.ts` |
