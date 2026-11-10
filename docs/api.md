# API

The Node server exposes three surfaces: the Evolution API webhook, the Google OAuth callback, and the panel API (`/api/*`, used only by the panel). Request and response bodies are JSON. Full contracts with examples are in the feature specs: [002](../specs/002-whatsapp-web-inbox/contracts/panel-api.md), [003](../specs/003-google-calendar-scheduling/contracts/panel-api.md), [004](../specs/004-whatsapp-anti-ban/contracts/panel-api.md), [005](../specs/005-customer-name-registry/contracts/panel-api.md), [006](../specs/006-panel-appointments-reminders/contracts/panel-api.md). This page is the index.

## Public routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness check |
| `POST /webhooks/evolution?token=…` | `EVOLUTION_WEBHOOK_TOKEN` in the query | Evolution API events: `messages.upsert`, `send.message`, `connection.update`, `qrcode.updated`. Always answers 200 quickly; 401 on a wrong token. [evolution-webhook.ts](../src/routes/evolution-webhook.ts) |
| `GET /auth/google/callback` | signed `state` (10 min) | End of the Google OAuth consent; stores the encrypted refresh token and redirects to the panel (`PANEL_URL`). [google-oauth.ts](../src/routes/google-oauth.ts) |

## Panel API

Every `/api/*` route needs the session cookie `sf_session`, except `POST /api/session`. Common errors:

| Status | `error` | When |
|---|---|---|
| 401 | `unauthenticated` | No or expired session; the panel goes back to login |
| 415 | `unsupported_media_type` | POST/PUT/PATCH without `application/json` |
| 422 | `invalid_body`, `invalid_rules`, … | Validation failed; some include `issues: [{ path, message }]` |
| 503 | `panel_disabled` | `OPERATOR_PASSWORD` not set |

### Session — [panel-session.ts](../src/routes/panel-session.ts)

| Route | Notes |
|---|---|
| `POST /api/session` `{password}` | 204 + cookie; 401 `invalid_credentials`; 429 `too_many_attempts` with `retry_after_s` |
| `GET /api/session` | 200 when logged in |
| `DELETE /api/session` | Logs out |

### WhatsApp connection and conversations — [panel-api.ts](../src/routes/panel-api.ts)

| Route | Notes |
|---|---|
| `GET /api/connection` | `{state: open\|connecting\|close, number, qr}` |
| `POST /api/connection/qr` | Requests a new QR code (limited, [BR-AB-07](business-rules.md#br-ab-07--warm-up-and-automatic-brake)) |
| `DELETE /api/connection` | Logs the number out (which deletes all conversations) |
| `GET /api/conversations?q=` | List, newest first; searches name, said name and phone |
| `DELETE /api/conversations` | Deletes all conversations and messages; returns `{deleted}` |
| `GET /api/conversations/:id/messages?before=&limit=` | Page of messages (max 100), newest first, with `hasMore` |
| `POST /api/conversations/:id/read` | Clears the unread count |
| `PATCH /api/conversations/:id` | `{assistantPaused: bool}` to pause/resume, or `{optedOut: false}` to reactivate an opted-out patient. Opting a patient out from the panel is not allowed. |
| `POST /api/conversations/:id/messages` | `{text, confirmRisk?}` operator message. 201 sent; 502 failed; 409 `whatsapp_disconnected` or `risk_confirmation_required` with `risks: [cold_contact\|opted_out\|protection_paused]` |
| `POST /api/messages/:id/retry` | Resends a failed operator message; 429 `retry_too_soon` with `retryAt` |
| `GET /api/protection` | Gate state: `normal\|warmup\|paused`, limits and current usage. [panel-protection.ts](../src/routes/panel-protection.ts) |

### Calendar and booking rules — [panel-calendar.ts](../src/routes/panel-calendar.ts)

| Route | Notes |
|---|---|
| `GET /api/calendar` | `{connection, rules}`: email, calendar, time zone and status (`connected`, `needs_reauth` or `disconnected`), plus the booking rules |
| `POST /api/calendar/connect` | `{url}` of the Google consent screen; 503 `google_not_configured` |
| `GET /api/calendar/calendars` | The account's calendars; 409 `calendar_disconnected`, 502 `calendar_unavailable` |
| `PUT /api/calendar/selection` | `{calendarId}` |
| `PUT /api/calendar/rules` | Booking rules ([BR-SCH-01](business-rules.md#br-sch-01--free-times-come-from-the-rules-and-the-calendar)); 422 `invalid_rules` with `issues` |
| `DELETE /api/calendar` | Disconnects and revokes the token |

### Appointments and panel booking — [panel-appointments.ts](../src/routes/panel-appointments.ts)

| Route | Notes |
|---|---|
| `GET /api/appointments` | Booked appointments grouped `today`, `tomorrow`, `week` (next 7 days) in the calendar's time zone. Each has name, service, phone, origin, notes, `conversationId` and `reminder: {label, reason, sentAt}` ([labels](business-rules.md#reminder-states)) |
| `POST /api/appointments/:id/confirm` | Confirms by the operator; idempotent |
| `GET /api/services` | `{services: [{name, label}]}`: the services a customer can book, in the assistant's order. `name` is the stored key (the treatment's key, or `Assessment`); `label` is the treatment's title, and "General assessment" for Assessment. Source: the bookable treatments of `knowledge_sections` plus the assessment ([catalog.ts](../src/modules/scheduling/catalog.ts), ADR 0014) |
| `GET /api/booking/days` | Days with free times inside the patient window (`maxDaysAhead`, quick chips), plus `minDate` (today) and `maxDate` (today + 365 days, the staff window), both `YYYY-MM-DD` in the clinic time zone |
| `GET /api/booking/slots?date=YYYY-MM-DD[&service=KEY]` | The times offered on that day for the service's appointment length (the default length without `service`). Any date from `minDate` to `maxDate` is answered, including dates beyond the patient window; outside that range the list is empty |
| `GET /api/booking/lookup?phone=` | Normalized phone, name (registry, else said in the chat), `hasConversation` and `futureAppointment`; 422 `invalid_phone` |
| `POST /api/appointments` | `{phone, name, service, start}` (`service` is one of the `name`s of `GET /api/services`); 201 `{appointment}`; 409 `slot_taken` (with `date` and fresh `slots`), `already_booked` (with the appointment) or `calendar_disconnected`; 502 when Google fails; 422 with `issues` |

### Customers — [panel-customers.ts](../src/routes/panel-customers.ts)

| Route | Notes |
|---|---|
| `GET /api/customers` | Registry with notes, `conversationId` and appointments |
| `PATCH /api/customers/:id` | `{name?, notes?}` (strict). Returns `{customer, calendarUpdated}`; `calendarUpdated: false` means Google event titles couldn't be renamed ([BR-NAM-04](business-rules.md#br-nam-04--editing-a-name-updates-everything-ahead)) |
| `DELETE /api/customers/:id` | 204; the conversation forgets the name |

### Real-time events — [panel-events.ts](../src/routes/panel-events.ts)

`GET /api/events` is a Server-Sent Events stream with a heartbeat every 15 s, sent as a named `ping` event (a comment would be invisible to the browser's `EventSource`); the panel reconnects and reloads its data when it hears nothing for 45 s, which also covers a proxy that keeps the connection open after the server died. While at least one panel is connected, the server polls the WhatsApp connection state. Event types ([events.ts](../src/modules/inbox/events.ts)):

| Event | Payload |
|---|---|
| `message.created`, `message.updated` | `conversationId`, `message` |
| `conversation.updated` | `conversation` |
| `conversations.cleared` | — |
| `appointments.updated`, `customers.updated` | — (the page reloads its list) |
| `connection.updated` | `state`, `number`, `qr` |
| `calendar.updated` | `connection` |
| `protection.updated` | gate state, as `GET /api/protection` |

### Knowledge — [panel-knowledge.ts](../src/routes/panel-knowledge.ts)

The brochure sections the assistant answers from ([knowledge](data-model.md#knowledge_sections)). A fact may carry `assessment: true` (BR-KNO-01: its line reaches the RAG with a note in the clinic language). Invalid bodies are `400 {error: "invalid_body", message}`; an unknown key is `404 {error: "not_found"}`. Each create, update, delete and reorder also re-reads the booking catalog (`onChange`, ADR 0014).

| Route | Body | Answer |
|---|---|---|
| `GET /api/knowledge` | — | `{sections, labels, hours}`: the sections in position order; `labels` are the field labels in the clinic language (with `address`, `hours`, `contact` for the clinic section); `hours` is the list of opening-hours lines generated from the scheduling rules (BR-KNO-02), which the form previews |
| `POST /api/knowledge` | `{kind: "treatment" \| "info" \| "clinic", title, tagline?, data}`. A clinic takes `data: {intro: string[], address: string[] (min 1), phone?, email?, closing: string[]}`, with no hours | `201 {section}`. The key is a slug of the title, with `-2`, `-3`… when taken (`order` is never used). Appended at the end |
| `PUT /api/knowledge/:key` | `{title, tagline?, data}` | `200 {section}`. Key, kind and position stay |
| `DELETE /api/knowledge/:key` | — | `204` |
| `PUT /api/knowledge/order` | `{keys: string[]}` | `204`. Must list every section exactly once; otherwise `400 {error: "invalid_order", message}` |
| `GET /api/knowledge/status` | — | `{version, indexedVersion, state}`; `state` is `upToDate`, `unpublished` or `unavailable` (RAG unreachable) |
| `POST /api/knowledge/publish` | — | Asks the RAG to reindex. `200 {version, indexedVersion, state}`; `409 {error: "already indexing"}`; `502 {error: "rag_unavailable"}` |

`version` is the hash of the current sections, with the opening-hours lines of the rules inside the clinic section, so a change in the Calendar page makes the status `unpublished` (`toDocument` in [render.ts](../src/modules/knowledge/render.ts)); `indexedVersion` is the version the RAG's index was built from (`knowledge.version` of its `/health`, while `index.state` is `current`; `null` otherwise). Nothing is sent to the RAG until the publish.

### Clinic identity (`panel-clinic.ts`)

| Route | Body | Response |
|---|---|---|
| `GET /api/clinic-settings` | — | `{name, assistantName, kind, language, restartRequired}`. `assistantName` is `null` when there is none; `restartRequired` is `false` here (see below) |
| `PUT /api/clinic-settings` | `{name}` (1–120), `{assistantName}` (0–60, empty means none), `{kind}` (1–80), `{language}` (`en` or `pt`, required) | `200` in the GET shape; `400 {error: "invalid_body", fields}` otherwise. Saved to `clinic_settings` and applied at once, with no restart: the next message, brochure answer, reminder and `/internal/clinic` use the new language (ADR 0016) |

## Internal routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /internal/knowledge` | `Authorization: Bearer <INTERNAL_TOKEN>` | The clinic's brochure for the RAG service: `{name, version, sections: [{title, body[]}]}`. `version` is the sha256 of `name` and `sections`, so any edit changes it. The bodies are rendered in `CLINIC_LANGUAGE` (the assessment notes, BR-KNO-01; the HORÁRIO lines of the clinic section come from the scheduling rules, BR-KNO-02). 401 without or with a wrong token; the route does not exist while `INTERNAL_TOKEN` is empty. Outside the panel login. [knowledge-internal.ts](../src/routes/knowledge-internal.ts) |
| `GET /internal/clinic` | `Authorization: Bearer <INTERNAL_TOKEN>` | The clinic's identity for the RAG service: `{name, kind, language, treatments}`, read from the live clinic context and the knowledge table on each request. `treatments` lists `{title, otherNames, extraLabels}` for every treatment: the RAG turns `otherNames` into query synonyms, takes the first title as the prompt's example treatment, and writes rule 5 (values with their own names, such as "Custo inicial" and "Mensalidade", taken from `extraLabels`) from them. 401 without or with a wrong token; the route does not exist while `INTERNAL_TOKEN` is empty. Outside the panel login. [clinic-internal.ts](../src/routes/clinic-internal.ts) |

## RAG service

The Python service has its own API on `127.0.0.1:8001`: `GET /health`, `POST /answer {question, history}`, `POST /retrieve {question}`. See [rag/README.md](../rag/README.md) and [specs/001 contract](../specs/001-rag-whatsapp-dentalsafe/contracts/rag-service.md).
