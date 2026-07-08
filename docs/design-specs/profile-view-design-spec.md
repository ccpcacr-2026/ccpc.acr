# Profile View Design Spec — "Card + Tabs" Pattern

Source: reference mockups generated 2026-07-08 ("ChatGPT Image Jul 8, 2026, 07_58_06 AM.png" and "08_04_45 AM.png", stored at `D:\important\vs code\CCPC_ACR\`), showing a "Student Profile" screen. User explicitly confirmed **only the profile view** from these mockups is wanted — not the surrounding dashboard/sidebar/finance modules shown in the same images. This document describes that one screen in enough detail to rebuild it without re-viewing the source images.

This is written as a **generic pattern** (fields are the student-profile example from the mockup) so it can be adapted to either portal — `ccpc-teachers`'s own Personal Hub (Teacher/Staff fields) or a future `ccpc-students` profile page (Student fields) — by swapping the field list in each section while keeping the structure, spacing, and visual language identical.

## Overall structure (top to bottom)

1. Breadcrumb + page actions row
2. Tab bar
3. Identity card (photo, name, ID barcode, quick-stat chips)
4. Two-column info grid (Personal Information | Academic Information + Guardian Information stacked)
5. Two-panel footer row (Academic Overview table | Attendance Overview donut chart)

## 1. Breadcrumb + actions row

- Left: breadcrumb text, small and gray — `Dashboard  >  My Profile` (`>` rendered as a chevron icon, not literal text), ~12px, medium-gray (`#6B7280`-ish).
- Right: three controls in a row, right-aligned:
  - A small square icon button (clock/history glyph) — muted gray, white/light background, rounded-lg border.
  - A small square icon button (`+` glyph) — same style as above.
  - A pill button, solid **dark navy/near-black** background, white bold text, label **"Edit Profile"**, rounded-full or rounded-xl (~10px radius), modest padding (~16px horizontal, 8px vertical).

## 2. Tab bar

Horizontal row of text tabs, no boxes/pills — underline-style:
`Overview` · `Academic` · `Attendance` · `Examinations` · `Documents` · `Activities`

- Active tab (**Overview** by default): bold, dark navy/black text, with a **solid blue underline** (2-3px) directly beneath it, sitting on a thin full-width bottom border shared by the whole tab row (the underline is the accent color, the shared row border is a very light gray).
- Inactive tabs: medium-weight gray text, no underline, same baseline.
- Comfortable horizontal gap between tab labels (~24-32px).

## 3. Identity card

White rounded-2xl card, soft shadow, generous padding (~24px).

**Row A — photo + name + barcode:**
- Left: square photo, ~90×90px, rounded corners (~12px), real photograph (student in uniform — for a teacher variant, professional headshot).
- Immediately right of photo: name in large bold dark text (~22-24px) — e.g. "Arafat Rahman" — with a small **blue circular checkmark/verified badge** icon immediately after the name (inline, same baseline, ~16px).
  - Line 2 below name: class/designation in medium gray (e.g. "Class XI - Science" for a student; would be "Lecturer (Physics)" for a teacher).
  - Line 3: ID line in smaller gray (e.g. "Student ID: 20241157").
- Far right of the row: a horizontal **barcode graphic** (black bars on white, no visible number beneath in the reference) — decorative/representational, doesn't need to be a real scannable barcode unless a real ID-card use case demands it.

**Row B — quick-stat chips** (directly below Row A, still inside the identity card):
Three (or four) small stat chips in a horizontal row, each chip:
- A small colored circular icon badge on the left (each chip uses a different pastel-tinted circle — e.g. blue-tinted, purple-tinted, teal-tinted — with a simple line icon inside: a numbered/list icon, a document icon, a graduation-cap icon).
- To the right of the icon: value on top in **bold black**, label below in small **gray uppercase-ish** caps.
- Examples from the mockup: `17 / Roll No.`, `24157 / Reg. No.`, `Science / Group`, `B+ / Blood Group`.
- Chips are NOT boxed/bordered individually — they sit directly on the card's white background, separated by generous horizontal gaps (~32-40px), so they read as a loose row of labeled stats rather than a button group.

## 4. Two-column info grid

Two cards side by side (stack vertically on mobile), same white rounded-2xl / soft-shadow / ~24px-padding treatment as the identity card.

**Left card — "Personal Information"**
- Section title: bold, dark, ~14px, sits alone at the top of the card.
- Below it, a vertical list of label/value rows (not a table — no borders between rows), each row: gray label on the left (fixed-ish width, e.g. "Date of Birth", "Gender", "Contact", "Email", "Address"), bold dark value directly to its right on the same line where it fits, wrapping to a second line for longer values (Address).
- Comfortable vertical rhythm between rows (~10-12px gap).

**Right column — two stacked cards:**
- **"Academic Information"** (top): section title same style as above, then a **2×2 grid** of label/value pairs (not a single list) — e.g. Roll No. / Registration No. / Section / Group. Each cell: gray label above, bold dark value below (stacked, not inline) — visually distinct from the Personal Information card's inline-label style, giving this card a denser "spec sheet" feel.
- **"Guardian Information"** (bottom, separate card directly below): same section-title style, then a label/value list (inline style, like Personal Information) for Father's Name, Mother's Name, Guardian Contact, (Guardian Email if applicable).

## 5. Footer row — Academic Overview + Attendance Overview

Two cards side by side (Academic Overview wider, ~65% width; Attendance Overview narrower, ~35%). Stack vertically on mobile.

**Academic Overview (table):**
- Section title top-left, plain text, bold.
- A clean data table, no heavy borders — light gray horizontal rule between rows only, no vertical rules, no zebra striping.
- Columns: `Subject | 1st Term | 2nd Term | Final Term | Average | Grade`.
- Header row: small gray uppercase-ish labels.
- Body rows: subject name in bold dark on the left, numeric scores in regular dark centered/left-aligned, **Grade column right-aligned with the letter grade in bold** (e.g. "A+", "A") — grade text can optionally be tinted (e.g. a subtle green for A+/A tiers) as a refinement, though the reference just uses plain bold dark text.
- A row where a term hasn't happened yet shows a literal `-` (e.g. "Final Term" column before results are in), not a blank cell — keeps the grid visually intact.

**Attendance Overview (donut chart):**
- Section title top-left.
- Centered **ring/donut chart**, large bold percentage in the center (e.g. "92%") with "Overall" in small gray directly beneath it inside the ring.
- Ring segments use three semantic colors: **green** (Present), **amber/yellow** (Absent), **red** (Leave) — proportional arc lengths matching the real percentages, not fixed thirds.
- Legend to the right of (or below, on narrow widths) the ring: three rows, each a small colored dot + label + percentage, in the same order as the ring segments (Present/Absent/Leave).
- Below the legend: a small muted text line, "Total Classes: 120".

## Color palette (extracted from the reference)

| Role | Value (approx) | Used for |
|---|---|---|
| Accent / brand blue | `#1D4ED8`–`#2563EB` range | Verified badge, active tab underline, primary icon accents, CCPC wordmark |
| Ink (headings/values) | near-black, `#111827`-ish | Names, section titles, bold values |
| Muted (labels) | mid-gray, `#6B7280`-ish | Field labels, breadcrumb, tab-inactive text |
| Card surface | white | All cards |
| Page canvas | very light gray, `#F3F4F6`-ish | Behind the cards |
| Success / present | green, `#10B981`-ish | Attendance "Present" |
| Warning / absent | amber, `#F59E0B`-ish | Attendance "Absent" |
| Danger / leave | red, `#EF4444`-ish | Attendance "Leave" |
| Primary button | dark navy/near-black | "Edit Profile" |

Cards: white background, `border-radius` ~16-20px, soft drop shadow (`0 1px 3px rgba(0,0,0,.06), 0 8px 24px -8px rgba(0,0,0,.08)`-ish — soft, not harsh), generous internal padding (~20-24px), comfortable gaps between cards (~16-20px).

## Typography

- Clean geometric/grotesk sans throughout (visually reads as Inter/SF Pro/Roboto family — no serif anywhere in this screen).
- Weight hierarchy does most of the work: **bold/black** for names, section titles, and values; **regular/medium** gray for labels and secondary text. No italics, no all-caps shouting except small chip labels which read as light-tracked caps.
- Numbers in the Academic Overview table and stat chips should use tabular/monospaced-figure alignment where the app's font stack supports it, so columns of scores line up.

## Responsive notes (not fully shown in the static mockup, but implied by the rest of this session's mobile-first patterns already used in `ccpc-teachers`)

- Identity card: photo + name row stays side-by-side even on mobile (photo shrinks slightly); the barcode graphic can drop or move below the name block if width is tight.
- Quick-stat chips: wrap to two rows on narrow screens rather than shrinking illegibly.
- Two-column info grid → stacks to one column (Personal Information, then Academic Information, then Guardian Information) on mobile, in that order.
- Footer row (Academic Overview + Attendance Overview) → stacks vertically on mobile, table gets its own `overflow-x-auto` wrapper per this project's existing convention (see `ccpc_teachers_architecture` memory).

## What this spec deliberately excludes

Per explicit user instruction, this spec covers **only the profile view**. It does not include: the sidebar navigation, the stat-card dashboard row, donut/line charts elsewhere, the Fees/Payments/Invoicing module, the Parents role, or any of the other screens shown in the same source images. Those were explicitly *not* what the user wants built from this reference.
