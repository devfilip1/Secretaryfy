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
| `GET /api/booking/days` | Days with free times |
| `GET /api/booking/slots?date=YYYY-MM-DD` | Free times on that day |
| `GET /api/booking/lookup?phone=` | Normalized phone, name (registry, else said in the chat), `hasConversation` and `futureAppointment`; 422 `invalid_phone` |
| `POST /api/appointments` | `{phone, name, service, start}`; 201 `{appointment}`; 409 `slot_taken` (with `date` and fresh `slots`), `already_booked` (with the appointment) or `calendar_disconnected`; 502 when Google fails; 422 with `issues` |

### Customers — [panel-customers.ts](../src/routes/panel-customers.ts)

| Route | Notes |
|---|---|
| `GET /api/customers` | Registry with notes, `conversationId` and appointments |
| `PATCH /api/customers/:id` | `{name?, notes?}` (strict). Returns `{customer, calendarUpdated}`; `calendarUpdated: false` means Google event titles couldn't be renamed ([BR-NAM-04](business-rules.md#br-nam-04--editing-a-name-updates-everything-ahead)) |
| `DELETE /api/customers/:id` | 204; the conversation forgets the name |

### Real-time events — [panel-events.ts](../src/routes/panel-events.ts)

`GET /api/events` is a Server-Sent Events stream with a heartbeat every 25 s. While at least one panel is connected, the server polls the WhatsApp connection state. Event types ([events.ts](../src/modules/inbox/events.ts)):

| Event | Payload |
|---|---|
| `message.created`, `message.updated` | `conversationId`, `message` |
| `conversation.updated` | `conversation` |
| `conversations.cleared` | — |
| `appointments.updated`, `customers.updated` | — (the page reloads its list) |
| `connection.updated` | `state`, `number`, `qr` |
| `calendar.updated` | `connection` |
| `protection.updated` | gate state, as `GET /api/protection` |

## RAG service

The Python service has its own API on `127.0.0.1:8001`: `GET /health`, `POST /answer {question, history}`, `POST /retrieve {question}`. See [rag/README.md](../rag/README.md) and [specs/001 contract](../specs/001-rag-whatsapp-dentalsafe/contracts/rag-service.md).
