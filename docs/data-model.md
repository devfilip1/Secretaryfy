# Data model

**Database:** PostgreSQL 17 (Docker, host port 5434) · **Schema source:** [src/db/schema.ts](../src/db/schema.ts) · **Migrations:** [drizzle/](../drizzle), generated with `npm run db:generate`

The Evolution API keeps its own data in the same database, in the `evolution_api` schema. Secretaryfy never reads it.

## Diagram

```mermaid
erDiagram
  conversations ||--o{ messages : has
  conversations ||--o| scheduling_sessions : "dialogue in progress"
  conversations |o--o{ appointments : "booked from (set null)"
  customers |o--o{ appointments : "registered as (set null)"
  scheduling_sessions }o--o| appointments : "being cancelled/moved"
  conversations {
    uuid id
    text phone UK
    text name "WhatsApp profile"
    text customer_name "said in chat"
    bool assistant_paused
    bool needs_attention
  }
  messages {
    uuid id
    text wa_message_id UK
    enum origin
    enum status
    text error "block reason"
  }
  customers {
    uuid id
    text phone UK
    text name
    text notes
  }
  appointments {
    uuid id
    text phone
    text google_event_id UK
    timestamptz starts_at
    enum status
    enum reminder_status
    timestamptz confirmed_at
  }
```

Single-row and standalone tables: `calendar_connection`, `scheduling_rules`, `clinic_settings`, `protection_state` (one row each, enforced by a `check (id = 1)`), `contact_preferences` and `connected_numbers` (keyed by phone/number, no foreign keys).

The **phone number** (digits with country code, as WhatsApp sends it, e.g. `5571999999999`) is the real key across tables. `customers`, `appointments`, `contact_preferences` deliberately have no foreign key to `conversations`, so they survive deleting conversations or disconnecting the number ([ADR 0006](decisions/0006-appointment-belongs-to-phone.md)).

## Entities

### conversations
One per phone number.

| Field | Meaning |
|---|---|
| `name` | WhatsApp profile name. Only a label; never the patient's name ([BR-NAM-02](business-rules.md#br-nam-02--the-whatsapp-profile-name-is-never-the-patients-name)) |
| `customer_name` | Name the patient said in the chat |
| `name_asked_at` | When the assistant last asked for the name |
| `name_asks` | How many times it asked; at most 2 ([BR-NAM-01](business-rules.md#br-nam-01--the-assistant-asks-for-the-name-at-a-calm-moment-at-most-twice)) |
| `assistant_paused` | The assistant stays silent here until the operator resumes |
| `needs_attention` | Flagged for staff (hand-off, loop, limit) |
| `unread_count`, `last_message_*` | Panel list |

### messages
Every individual message sent or received by the connected number, plus internal notes.

| Field | Meaning |
|---|---|
| `origin` | `customer`, `assistant`, `operator` (panel), `phone` (clinic's own phone app), `system` (note in the history, never sent) |
| `status` | `received`, `sending`, `sent`, `failed`, `blocked` |
| `wa_message_id` | WhatsApp id, unique; null only while `sending`. Makes webhook delivery idempotent |
| `error` | Failure message, or the gate's block reason when `blocked` (`outside_window`, `duplicate`, `restart`…) |
| `note` | Typed system note (origin `system`): a `kind` and its data, which the panel translates. `text` keeps the English fallback. `null` on other messages and on rows from before migration 0013, which are not backfilled. Kinds in [system-note.ts](../src/modules/inbox/system-note.ts) |
| `sent_at` | WhatsApp time (seconds); `created_at` breaks ties |

### customers
The registry: everyone who confirmed a booking ([names and customers](business-rules.md#names-and-customer-registry)). `phone` is unique; `notes` is staff-only.

### appointments
Appointments made by the assistant or the panel. Google Calendar is the source of truth; this table is the local copy used for rules, reminders and the panel ([ADR 0005](decisions/0005-google-calendar-source-of-truth.md)).

| Field | Meaning |
|---|---|
| `phone` | Owner of the appointment; one future booked appointment per phone |
| `conversation_id` | Where it was booked; set to null if the conversation is deleted |
| `origin` | `assistant` or `panel` |
| `google_event_id`, `calendar_id` | The Google event |
| `customer_name`, `service` | As in the event title. `service` is the stored service name: the key of a treatment in `knowledge_sections`, or a fixed service, `Assessment` or `FollowUp` ([ADR 0014](decisions/0014-booking-services-are-the-clinics-treatments.md)). Rows from before ADR 0014 keep their English names (e.g. `Dental Cleaning`), not migrated. `service` is null for appointments before feature 005 |
| `customer_id` | Registry record, set to null if the record is deleted |
| `status`, `cancelled_by` | `booked` or `cancelled`; cancelled by `customer` (WhatsApp), `staff` (from the panel) or `calendar` (deleted in Google) |
| `reminder_status`, `reminder_reason`, `reminder_sent_at` | See [reminder states](business-rules.md#reminder-states) |
| `confirmed_at`, `confirmed_by` | Confirmed by `customer` (YES) or `operator` |

Unique partial index `appointments_booked_start_uq (calendar_id, starts_at) where status = 'booked'` is the database-level barrier against double booking ([BR-SCH-04](business-rules.md#br-sch-04--two-patients-never-get-the-same-time)).

### scheduling_sessions
At most one per conversation: the booking, cancel or reschedule dialogue in progress.

| Field | Meaning |
|---|---|
| `flow` | `book`, `cancel` or `reschedule` |
| `step` | `choose_day`, `choose_slot`, `ask_name`, `choose_service`, `confirm_booking`, `offer_reschedule`, `confirm_cancel`, `confirm_reschedule` ([diagram](message-pipeline.md#6b-scheduling-flow)) |
| `options` | The numbered options last shown: days, times or services |
| `selected_start`, `customer_name`, `service`, `appointment_id` | What's been chosen so far |
| `misunderstood_count` | Consecutive replies not understood; 2 hands over to staff |
| `expires_at` | 30 min after the last message |

### calendar_connection
The clinic's Google account and selected calendar: email, scopes, `refresh_token_enc` (AES-256-GCM, see [crypto.ts](../src/config/crypto.ts)), calendar id, name and time zone, and `status` (`connected` or `needs_reauth`). No row means disconnected.

### scheduling_rules
Opening hours per ISO weekday (`weekly_hours` JSON, `"1"` = Monday … `"7"` = Sunday; a missing day is closed), `slot_minutes` (the default appointment length), `grid_minutes` (the step of start times, default 15), `min_notice_minutes`, `max_days_ahead`, `cancel_notice_minutes`. Created with the defaults on first read ([rules.ts](../src/modules/scheduling/rules.ts)).

### clinic_settings
The clinic's identity as the panel edits it: `name`, `assistant_name` (nullable: no name, the greeting only names the clinic) and `kind` (the interpreter prompt's "dental clinic"), with `updated_at`. One row (`check (id = 1)`). The first start inserts it from `CLINIC_NAME`, `ASSISTANT_NAME` and `CLINIC_KIND` when there is no row; after that the row wins ([settings-repository.ts](../src/modules/clinic/settings-repository.ts), ADR 0012 step 2). `language` (`en` or `pt`, `check` constraint, migration 0012) is the language of the assistant and of the brochure labels (ADR 0016); while it is null, `CLINIC_LANGUAGE` is used, and the first save from the panel stores it. Four scheduling fields: `offer_assessment` (boolean, default true) and `offer_follow_up` (boolean, default false) say whether the booking offers a first-visit assessment or a follow-up; `assessment_minutes` and `follow_up_minutes` (integer, nullable) are their lengths, where null means the calendar's default length. When set, the minutes must be 15–240 in steps of 5 (`check` constraints `clinic_settings_assessment_minutes` and `clinic_settings_follow_up_minutes`, migration 0014). The scheduling catalog does not read them yet.

### Anti-ban tables
- `contact_preferences`: `phone`, `opted_out_at`. Opt-out by phone, survives disconnection.
- `connected_numbers`: every number ever connected, with `first_connected_at` (starts the 14-day warm-up).
- `protection_state`: the automatic brake: `paused_until` and `reason` (`send_failures` or `connection_drops`).

Send counts for the limits are read from `messages` (index `messages_outgoing_sent_at_idx`), not kept in a separate table.

### knowledge_sections
The clinic's brochure, one row per section (ADR 0010, step 2). `key` is a stable slug, unique; `kind` is `treatment`, `info` or `clinic` (checked); `title` is the heading without `## `; `tagline` is the part after ` — ` (treatments only); `data` is JSON: for a treatment `{ideal?, howItWorks?, facts, result?, recovery?}` with labelled values (a fact may add `assessment?: boolean`, BR-KNO-01), for an info section `{lines}`; for the clinic `{intro, address, phone?, email?, closing}`, with no hours: the HORÁRIO lines come from the scheduling rules (BR-KNO-02); `position` is the display order. The importer turns `assessment` on for price facts. A treatment may carry `otherNames?: string[]` (other words patients use for it, read by the RAG as query synonyms) and `bookable?: boolean`: `false` keeps it information-only, while absent or `true` lets the assistant book it (ADR 0014; the RAG ignores this flag). Validated with zod ([types.ts](../src/modules/knowledge/types.ts)). Filled from a Markdown brochure by `scripts/import-knowledge.ts`, which replaces all rows in one transaction; read by `GET /internal/knowledge` ([render.ts](../src/modules/knowledge/render.ts)).

## Lifecycle and deletion

| Action | Deletes | Keeps |
|---|---|---|
| Number logged out / "Delete all conversations" | conversations, messages, scheduling sessions | appointments (conversation link nulled), customers, opt-outs, connected numbers |
| Delete one conversation (panel) | that conversation, its messages, scheduling sessions | appointments (conversation link nulled), customers, opt-outs |
| Delete a customer | the customer row; the conversation's `customer_name` | appointments (customer link nulled) and Google events |
| Appointment deleted in Google | — (marked `cancelled` / `calendar` on next sync) | the row |

## Data protection

Messages, names, phone numbers and notes are personal data (LGPD). There is no retention policy or automatic purge; data stays until the number is disconnected or staff delete it. The Google refresh token is the only value encrypted at rest. See the [open questions](README.md#open-questions).
