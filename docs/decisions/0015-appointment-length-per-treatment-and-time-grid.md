# 0015 · Appointment length per treatment and a 15-minute time grid

**Status:** Accepted · **Date:** 2026-11-06

## Context
Every appointment lasts `slotMinutes` (60 by default) and start times sit on that same step (9:00, 10:00, 11:00). A 30-minute cleaning blocks a whole hour, a long treatment blocks only an hour, and a clinic with several chairs or short visits loses capacity. The patient also sees every free hour of the day.

## Decision
1. **Each treatment may carry `appointmentMinutes`** (5 to 480, a multiple of 5) in its knowledge data. It is the time blocked in the calendar, not the brochure's "Duração" text, which the patient reads. A treatment without it, and the general assessment, use `slotMinutes`, which now means "default appointment length".
2. **Start times sit on a grid** (`gridMinutes` in the scheduling rules, default 15). A start is free when `[start, start + minutes)` is inside the opening hours, after the minimum notice, and overlaps no busy interval of the calendar. The existing `overlaps` check is the only blocking rule.
3. **The treatment is known before the day is offered.** `startBook` asks for it when the conversation did not name it (the list that was asked after the name), because the length decides which starts are free. Reschedule keeps the length of the appointment being moved (`endsAt - startsAt`).
4. **The patient sees a few "best" times, not the whole grid.** A start is *natural* when it is the first of the day, the first after a busy block, or lines up with the treatment's length from opening. The list shows up to six natural starts; "more" shows the next natural ones.
5. **A time the patient names is checked on the full grid.** The interpreter returns an optional `time` (`HH:MM`, 24 h). Free: it is selected. Taken or off the grid: the assistant says so kindly and offers the nearest free starts of the same day. The model only reads the time; the code decides.
6. **Booking uses the same length.** `bookSlot` computes the end from the service, so the calendar event, the stored `ends_at` and the double-booking check agree. Changing a treatment's length does not touch appointments already made.

## Alternatives considered
- **Keep one length for everything and only shorten the grid:** still wastes time for short treatments and double-books long ones.
- **Ask the treatment after the time (as before) and re-check:** the offered list would be wrong for the real length, and the patient would be sent back after choosing.
- **Show the full grid:** a day of 15-minute starts is dozens of lines in WhatsApp.

## Consequences
- Migration 0011 adds `scheduling_rules.grid_minutes` (default 15). Treatment data is JSON, so `appointmentMinutes` needs no migration.
- The booking conversation gains a question when the treatment is unknown, and loses it later.
- Panel: the Calendar page gets "Time grid" and renames the length to "Default appointment length"; the treatment form gets "Appointment time (minutes)" with the default shown; the new-appointment dialog lists starts for the chosen treatment.
- The unit tests of availability, flow, booking and the interpreter eval grow; `scripts/eval-scheduling.ts` gets scenarios with a named time and with different lengths.
