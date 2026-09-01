# Design system

Lives in `packages/ui`. Tailwind v4, CSS-first — there is no `tailwind.config.js`; the
tokens are in `packages/ui/src/styles/globals.css`.

---

## Two layers of tokens

```
PRIMITIVE   --color-leoni-blue-600, --color-gray-200, --color-red-600
            Raw values. NEVER used directly in a component.
                    │
                    ▼
SEMANTIC    --color-primary, --color-foreground-muted, --color-status-critical
            Named by ROLE. This is what components use.
```

A component that says `bg-status-critical` keeps meaning the right thing when the palette
changes. One that says `bg-orange-600` has to be found and edited — and the one occurrence
someone misses is the one on the screen shown at the defence.

**Both of these are lint errors:**

```tsx
<div className="bg-[#0056A4]" />   // ✗ arbitrary value
<div style={{ color: "#e11" }} />  // ✗ raw hex
```

The fix is never to disable the rule. Add a semantic token and use the generated utility.

---

## Domain status tokens

The four stock levels and the request phases are **part of the design system**, not a
decision each screen makes:

```css
--color-status-normal   / --color-status-normal-subtle
--color-status-warning  / --color-status-warning-subtle
--color-status-critical / --color-status-critical-subtle
--color-status-rupture  / --color-status-rupture-subtle

--color-phase-draft  --color-phase-pending  --color-phase-active
--color-phase-done   --color-phase-stopped
```

This is why the alert board, the article detail, the dashboard and the exports all render
"Critique" identically. Never map a status to a colour in a component — use
`<AlertLevelBadge>` or `<RequestStatusBadge>`.

**Fourteen request statuses map onto five phases, not fourteen colours.** A reader scanning
a list is asking one question — is this waiting on someone, moving, finished, or stopped —
and fourteen hues answer it worse than five. The exact status is still written in words; the
colour only carries the phase.

---

## Colour is never the only signal

`AlertLevelBadge` pairs every level with a distinct icon (✓ / ⚠ / ◑ / ⛔). Two reasons, both
concrete:

- colour alone does not convey severity to a colour-blind user;
- a warehouse monitor viewed at an angle washes out hue long before it washes out shape.

Any new status indicator must carry a non-colour signal too.

---

## Three layers of components

| Layer         | Knows about               | Examples                                                                        |
| ------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `lib/`        | Nothing                   | `cn()`, `formatQuantity`, `formatCoverage`                                      |
| `primitives/` | Styling only              | `Button`, `Badge`, `Card`, `Input`, `Table`, `Skeleton`                         |
| `patterns/`   | **The domain vocabulary** | `AlertLevelBadge`, `RequestStatusBadge`, `StatCard`, `PageHeader`, `EmptyState` |

Patterns knowing the domain is their _purpose_: they are the single place a stock level or a
request status becomes something a human reads.

**When to add which.** If two screens need the same visual element → primitive. If two
screens need the same _domain_ element → pattern. If only one screen needs it → keep it in
`apps/web/src/features/<feature>/`.

The whole package never imports `@leoni/api`, `@leoni/db` or `@leoni/auth`. Components
receive data as props — which is what lets any of them be rendered in a test or a report
screenshot without a database.

---

## Numbers

Quantities are read **down a column**. Two consequences, both non-negotiable:

- use `TableNumericCell` / `TableNumericHead`, or the `.tabular` class — proportional digits
  make a column of stock levels impossible to scan;
- format with the helpers in `@leoni/ui` (`formatQuantity`, `formatDecimal`,
  `formatCoverage`, `formatDate`), never ad-hoc `toLocaleString` calls. They are `fr-FR`, so
  a quantity reads `3 716` and a coverage `4,7 j`.

`formatCoverage(null)` renders `—`. An article with no measured consumption has _no_
coverage, which is genuinely different from "zero days of cover" and must never be shown as
a number.

---

## Layout

- Wide tables scroll inside `TableContainer`, never the page. The target is a 1366×768
  warehouse desktop, and a page that scrolls sideways as a whole is far worse to use than a
  table that does. This is why the shell carries `min-w-0` at both levels.
- A visible focus ring is mandatory (`:focus-visible` in the base layer): parts of this
  application are driven with a barcode scanner and a keyboard, not a mouse.
- Light-first. The dark palette redefines only the semantic layer, never the primitives.
- **Two themes, two blocks, no third.** `:root` is light; `:root[data-theme="dark"]` is dark.
  There is no `prefers-color-scheme` block: the theme script in `apps/web` resolves the
  operating system preference to an explicit `data-theme` before the first paint, so
  "follow the system" and "I chose dark" reach the stylesheet as the same thing. A media
  query as well would mean every token written twice, and the copy that drifts is the one
  nothing checks — which is exactly how the dark theme shipped without
  `--color-foreground-on-primary`, putting white text on a light blue button.
  `theme-parity.test.ts` fails the build if the two blocks stop matching.
- **Both blocks set `color-scheme`.** Almost every input in this application is a native
  control — `<select>`, `<input type="date">`, checkboxes, scrollbars — and the browser
  paints those itself. Without `color-scheme: dark` they stay white, and a dark theme with
  white holes punched through it is worse than no dark theme.
- **In dark, elevation goes up, not down.** A shadow is invisible on a near-black page, so a
  dialog reads as floating by sitting on `surface-raised` (lighter) rather than by having an
  edge. `surface-sunken` is lighter than `surface` in dark for the same reason — the role is
  "a distinct band", and darker would merge it into the background.
- **Signal colours move to the light end of their ramp in dark.** `orange-600` is the right
  "critique" on white and about 3:1 on `gray-950`, which fails for the small text a badge is
  made of. The `300`/`400` steps exist for this.

---

## Brand colour

`--color-leoni-blue-*` is currently a placeholder ramp approximating LEONI corporate blue
(~`#0056A4`), declared in OKLCH.

**To apply the real identity:** replace that one ramp in `globals.css`. Nothing else in the
codebase needs to change — that is the entire point of the two-layer token structure. The
logo should go in `apps/web/public/` and replace the `L` placeholder mark in
`app-sidebar.tsx` and the login page.
