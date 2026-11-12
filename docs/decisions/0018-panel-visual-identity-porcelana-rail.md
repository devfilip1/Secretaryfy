# 0018 · Panel visual identity: Porcelana, light and dark themes, rail navigation

**Status:** Accepted · **Date:** 2026-11-11

## Context
The panel grew page by page with inline styles and no shared visual system. Navigation was a top tab bar that did not fit a phone, the colours had no names, and the conversation list gave no sense of the day. Staff use the panel all day on a desktop and between patients on a phone, often in a bright reception or a dim room, so both themes had to be readable.

## Decision
1. **Colours and type are tokens.** The palette ("Porcelana") is a set of CSS variables on `:root` in [web/src/tailwind.css](../web/src/tailwind.css). The dark values are defined twice: under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`. A test keeps the two blocks equal, and [contrast.test.ts](../web/src/theme/contrast.test.ts) checks the text and status colours against WCAG contrast ratios in both themes.
2. **The theme is a choice stored in the browser.** The key is `secretaryfy.theme` (`light`, `dark`, or absent for the system setting). A small script in [web/index.html](../web/index.html) sets `data-theme` before the first paint, so the wrong theme never flashes. The choice is per browser, like the panel language's override (ADR 0016), and does not reach the server.
3. **The typeface is Schibsted Grotesk, bundled.** It comes from `@fontsource-variable` and its files are part of the project. No CDN, so opening the panel sends no request to a third party.
4. **Navigation depends on the screen.** On desktop a left rail holds the sections, labelled with short one-word labels (`nav.short.*` keys, so "Chats", "Calendar", "WhatsApp"). On a phone a bottom bar holds six tabs. A top bar on both shows the connection status and an account menu (clinic name, theme, language, sign out). There is no per-person login: one login per clinic, so the menu shows the clinic, not a user.
5. **Conversas opens with a day ruler.** A strip at the top shows today's appointments on a time ruler: each appointment is a solid block sized by its duration, coloured by status (confirmed, waiting, needs team). Blocks already passed are lighter and carry a check mark, and a progress fill runs up to the current time. It reads `GET /api/appointments?from=today` (ADR 0014, 0015), so it shows today's appointments that already started or ended.
6. **Consultas has three ranges.** Day, 7 days and Month, selected with `?days` (1 to 31, see [api.md](api.md)).
7. **The customers list is paginated** at 20 per page, client-side, so the page stays short on a phone.
8. **Components come from the shadcn CLI.** shadcn components are added with `npx shadcn@latest add`, never written by hand, so each one matches the upstream file and can be updated the same way.

## Alternatives considered
- **A CSS framework's default theme with class overrides:** colours spread across components and dark mode became a second set of exceptions.
- **A theme stored on the server:** the panel would need a database write for a visual preference and the first paint would wait for a request. A browser setting is enough for a per-person display choice.
- **Hosted web fonts:** a CDN request on each load, and a dependency on a third party for the clinic's staff screen.
- **A tab bar on desktop too:** the sections fit in a rail with room for the labels, and a top bar gets crowded with the connection and account controls.
- **Per-person logins:** would need user accounts and management; the panel keeps one login per clinic.

## Consequences
- A change to a colour is made once in `tailwind.css`, in both dark blocks; the test fails if the two drift apart.
- A new status colour must pass the contrast test in both themes before it is used.
- Phone and desktop navigation are two components over the same section list, so a new section is added in one place and shows in both.
- The day ruler adds one request to Conversas for today's appointments.
- The font files are bundled, so the panel's download grows by their size.
