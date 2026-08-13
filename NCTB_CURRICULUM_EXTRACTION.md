# NCTB Curriculum Extraction — chapter → lesson → learning-outcome data

## Purpose

Populate `teacher.lesson_curricula` (one row per Class+Subject+Version+Chapter,
a `lectures` jsonb array of `{lecture_number, topic, learning_outcome,
page_number, elaborate_summary, textbook_context}`) with the *official* NCTB
breakdown for every class × subject, so the Lesson Plan module's
Chapter/Lesson(s) picker and the AI draft generator have real data to work
from instead of staying empty until teachers type it in one plan at a time.

`elaborate_summary` is sourced from the **Teacher's Guide** (pedagogical
approach/activities/examples); `textbook_context` is sourced from the
**student Textbook** (the exact examples/numbers/exercises/images printed on
the referenced page(s)). Both are compact, pre-written text stored per
lesson specifically so that generating a lesson plan later never needs to
re-read or re-process the raw source PDFs — the AI prompt (`generateLessonPlanDraft`
→ `_lessonPlanDraftPrompt` in `app/api/exec/route.js`) uses only these small
stored strings plus the `book_url`, keeping token usage per generation low
regardless of how large the source PDFs were. `textbook_context` is optional
and not yet populated for any already-extracted chapter (all existing rows
have Teacher's-Guide-derived fields only) — see "Textbook context backfill"
below for the plan to add it.

This is large, ongoing work — tracked here and done in batches across
multiple sessions, not in one pass. Parts of the Lesson Plan module that
depend on this data (dropdowns, checkboxes, AI generation context) already
work correctly with *no* data present (graceful empty-state fallbacks), so
nothing is blocked on this finishing.

## Version tagging rules (CCPC-specific — confirmed with the user)

- **Class Nursery, One, Two: `version` is always "English Version"**, never
  "Bangla Version" — CCPC only runs these classes in the English Version
  stream. This applies to the *tag*, not necessarily the source PDF: the
  Bangla-medium NCTB Teacher's Guide content already extracted for Class One
  Mathematics (Chapters 1-2) was confirmed fine to keep content-wise, just
  retagged from Bangla to English Version (`lesson_curricula` ids 1-2,
  corrected). Content in translation is equivalent; only the tag was wrong.
- **Subjects NCTB only publishes one (Bangla-only) edition for** — e.g. বাংলা
  (the Bangla language subject itself), ইসলাম শিক্ষা, সংস্কৃত, পালি, সংগীত,
  আরবি — **insert the same chapter/lectures content as two rows**, one with
  `version: "Bangla Version"` and one with `version: "English Version"`, so
  the subject surfaces under the Chapter dropdown regardless of which
  Version stream a lesson plan is being created for. (`lesson_curricula` has
  one `version` per row, not a list — duplicating the row is the simplest
  correct fix, no handler changes needed.)

## Source documents

Two official NCTB document types are usable, at different levels of detail:

1. **শিক্ষক সহায়িকা (Teacher's Guide)** — the richer source. Per-class,
   per-subject PDFs with full pedagogical content: chapter/lesson breakdown,
   learning outcomes, teaching activities. **Preferred source** wherever a
   2026 edition exists.
2. **বার্ষিক পাঠ পরিকল্পনা (Annual Lesson Plan)** — a pacing/scheduling
   document only: chapter → lesson list → page numbers → period counts, no
   learning-outcome detail. Useful as a page-number cross-reference or for
   classes/subjects that don't have a Teacher's Guide yet.

Both are Bijoy-encoded, mostly-scanned PDFs — confirmed earlier this session
that text-layer extraction returns garbage (`pypdf`/`pymupdf` `.get_text()`)
even where a real embedded font exists. **Every page has to be rendered to
an image (`pymupdf`'s `page.get_pixmap()`, no external binary needed) and
read via vision**, then transcribed by hand into the structured shape above.

### Confirmed sources

| Level | Document | Status | Notes |
|---|---|---|---|
| Primary (Class 1–5) | 2026 শিক্ষক সহায়িকা, per-class per-subject | **In progress** — Class One Mathematics: Chapters 1-2 of 18 done | See nctb.gov.bd/pages/static-pages/69afd52278d3473aba19414d → one link per class → one link per subject (Google Drive). Class One alone lists ~10 subjects. **Files are huge** — Class One Bangla TG is 188MB, Mathematics TG is 485MB (184 pages), almost certainly scanned images throughout. Google Drive's "can't scan for viruses" interstitial needs the confirm-token workaround (extract `confirm`/`uuid` fields from the warning page's form, then GET `https://drive.usercontent.google.com/download?id=...&export=download&confirm=...&uuid=...`) — the plain `uc?export=download` shortcut used earlier this session for smaller files doesn't work at this size. |
| Primary (Class 1–5) | 2017 বার্ষিক পাঠ পরিকল্পনা, all subjects merged | Downloaded (188 pages), not yet read/transcribed | Local copy from this session's earlier work. Useful as a page-number/pacing cross-reference once the Teacher's Guide extraction is underway. |
| Pre-Primary | 2026 শিক্ষক সহায়িকা | **Source found**, not yet opened | nctb.gov.bd/pages/static-pages/69afb878ed85d1024840b2ec |
| Secondary (Class 6–10) | — | **Not yet found** | The combined 2026 "Pre-primary, Primary and Secondary" Teachers' Guide list page only actually lists Pre-Primary and Primary links — Secondary isn't published there yet (or lives elsewhere). First step when resuming: search nctb.gov.bd again for a secondary-specific 2026 Teacher's Guide, or fall back to the already-downloaded "মাধ্যমিক স্তরের শিক্ষাক্রম" curriculum/syllabus PDFs (2012 edition, downloaded this session) to check whether those go down to lesson-level granularity despite being framework/syllabus documents rather than a Teacher's Guide. |
| Higher Secondary | — | **Not yet found** | Same situation as Secondary. |

### Class One Teacher's Guide — subject links found so far (2026, from nctb.gov.bd/pages/static-pages/69afb7aee79e59e52d1be481)

| Subject | Google Drive link |
|---|---|
| বাংলা | https://drive.google.com/file/d/1z82Lbbd5WgFBARNv3z2sdwMevU-sb1lh/view |
| ইংরেজি | https://drive.google.com/file/d/1Mup_y0SbRjj0d9KTc0eVVPLCfN8rpKXF/view |
| প্রাথমিক গণিত | https://drive.google.com/file/d/1TxCEvcPdfcsWQ96lIq_dm3zYTVSM9ut5/view |
| সামাজিক বিজ্ঞান ও প্রাথমিক বিজ্ঞান | https://drive.google.com/file/d/1Lhy-gp84hzFHuq5pLmffxTK_69I-Fp0n/view |
| শারীরিক ও মানসিক স্বাস্থ্য শিক্ষা | https://drive.google.com/file/d/1qlTd2xVkb74KXhuLKi39c6Z-tPSaB5Fa/view |
| শিল্পকলা | https://drive.google.com/file/d/13_ygYo8r-_2dfOL911iZr1h5kFH1AsUw/view |
| ইসলাম ও নৈতিক শিক্ষা | https://drive.google.com/file/d/1N85-88foVrvRa0lUJ2iTIWREo7dilMvh/view |
| হিন্দুধর্ম ও নৈতিক শিক্ষা | https://drive.google.com/file/d/1j3qyb5acQMWC6VCFjDDjKG7urUllZ825/view |
| খ্রিষ্টধর্ম ও নৈতিক শিক্ষা | https://drive.google.com/file/d/1qplNgf_-kjC8q8WuHwlpr9jeFCMaTgYX/view |
| বৌদ্ধধর্ম ও নৈতিক শিক্ষা | https://drive.google.com/file/d/1caMAZWYMC6_fE189_7cmR8dPWpce32Wp/view |

**All 10 Class One Teacher's Guides are already downloaded and saved** to
`D:\NCTB books\Class One\English Version\<Subject> - Teacher's Guide.pdf`
(Mathematics, English, Bangla, Social Science and Elementary Science,
Physical and Mental Health, Arts, Islamic Studies, Hindu Religion,
Christian Religion, Buddhist Religion) — check there before re-downloading
anything for Class One. Only Mathematics has been transcribed into
`lesson_curricula` so far (18/18 chapters); the other 9 are downloaded but
not yet read/transcribed. Hindu Religion (237MB) and Christian Religion
(166MB) are unusually large for their page counts (90 and 68 pages) —
verified by rendering their cover pages that this is just richly-illustrated
content for Class One specifically, not multiple classes bundled together.

Classes Two–Five: links to each class's subject-list page are known
(from the class-list table), the per-subject links within each haven't
been fetched yet:
- Class Two: nctb.gov.bd/pages/static-pages/69afb81aa52ffd47032d0757
- Class Three: nctb.gov.bd/pages/static-pages/69afb842138848bf0fa5e79b
- Class Four: nctb.gov.bd/pages/static-pages/69afb8a7e79e59e52d1be566
- Class Five: nctb.gov.bd/pages/static-pages/69afb8d3a938e1f3ef6312d0

## Method (once resumed)

1. For a given (class, subject): download the Teacher's Guide PDF (large —
   use `curl -sL --cookie-jar` with Google Drive's confirm-token workaround
   for files that hit the "can't scan for viruses" interstitial, proven
   earlier this session for files up to ~21MB; these are much bigger, so
   expect to need chunked/patient downloads).
   **Save the downloaded PDF permanently to `D:\NCTB books\<Class>\<Version>\<Subject> - Teacher's Guide.pdf`**
   (e.g. `D:\NCTB books\Class One\English Version\Mathematics - Teacher's Guide.pdf`)
   — one folder per class, one subfolder per version (use whichever version
   tag that class/subject is being tagged with in `lesson_curricula`, per
   the version-tagging rules above). This is a persistent local library
   outside any session's scratchpad, so source PDFs never need re-downloading
   across sessions/subagents — always check here first before hitting Google
   Drive again.
2. Read pages via vision. Two options, prefer (b) going forward:
   a. Render each page to PNG via `pymupdf`
      (`page.get_pixmap(dpi=130).save(...)`) then `Read` each image
      individually — no external binary dependency, proven working, but
      one page per tool call (high overhead across a whole book).
   b. **Use the `Read` tool's native PDF support directly on the saved PDF**,
      with the `pages` parameter (e.g. `pages: "1-20"`, max 20 pages per
      call) — no rendering step needed, ~20x fewer tool calls per book.
      Not yet fully verified against this project's known Bijoy-font
      garbling issue (that issue was specifically in *text-layer*
      extraction via `pypdf`/`pymupdf .get_text()`; native PDF vision
      ingestion should read the rendered page correctly the same way the
      PNG approach did, but confirm on the first chapter of a new subject
      before trusting the rest of that book to it).
3. **Some Teacher's Guide PDFs bundle more than one subject** — e.g. Class
   One's "সামাজিক বিজ্ঞান ও প্রাথমিক বিজ্ঞান" is one PDF covering both
   Social Science AND Elementary Science as NCTB's own combined-subject
   naming (confirmed; this is intentional on NCTB's part, not a download
   error). Before transcribing a new PDF, skim its table of contents /
   opening pages far enough to confirm how many subjects (and which class
   range, if any) it actually spans, and treat each subject as a fully
   separate `lesson_curricula` `subject` value even when they share one
   source file. Process one subject at a time within a bundled file — don't
   try to transcribe the whole bundle in one continuous pass.
4. **Combine Teacher's Guide + Textbook reading into the same pass per
   subject**, rather than doing a full Teacher's-Guide-only extraction pass
   now and a separate Textbook backfill pass later — reopening/re-rendering
   the same subject's material twice (once per source) roughly doubles
   rendering/reading cost for no benefit. For each chapter: read the
   Teacher's Guide pages for that chapter (→ `elaborate_summary`,
   `learning_outcome`), then immediately read the matching Textbook page(s)
   for the same chapter (→ `textbook_context`, see field shape below) while
   already oriented in that chapter, and insert both together in one
   `lesson_curricula` row. The official student Textbook PDF link for a
   subject (when one exists) is in `_src/app.js`'s `NCTB_BOOKS` map — not
   every subject has a separate primary-level textbook (younger classes'
   Arts/Health/Religion subjects may only have a Teacher's Guide with no
   standalone student book; confirm before assuming one is missing by
   mistake).
5. Transcribe chapter headings, lesson numbers (পাঠ-১, পাঠ-২...), topics,
   learning outcomes, page numbers, and (for Math/Physics/Chemistry) any
   equations, into:
   ```json
   { "chapter": "...", "lectures": [
     { "lecture_number": 1, "topic": "...", "learning_outcome": "...",
       "page_number": "12", "elaborate_summary": "...",
       "textbook_context": "..." }
   ]}
   ```
   `elaborate_summary` = Teacher's Guide (pedagogy/activities/examples).
   `textbook_context` = student Textbook (exact examples/numbers/exercises/
   images on the referenced page(s)). Both are compact text, written so the
   AI draft generator never needs to re-read either source PDF at
   generation time (see `_lessonPlanDraftPrompt` in `app/api/exec/route.js`).
6. Load into `teacher.lesson_curricula` via the same insert path
   `saveLessonCurriculum` uses (class_name/subject/version/chapter/lectures/
   is_editable) — either through the existing UI form one chapter at a time,
   or a one-off seed script hitting the Supabase REST endpoint directly for
   bulk loading once a whole subject's data is transcribed.
7. Check off progress below.

## Progress checklist

- [ ] Confirm/locate Secondary + Higher Secondary source documents
- [ ] Pre-Primary — source opened, subjects enumerated
- [~] Class One — 10 subjects identified
  - [x] **Mathematics — COMPLETE. All 18/18 chapters loaded into `lesson_curricula` (id 1-18), 109 lessons total, tagged `version: "English Version"` per CCPC's Nursery-Two rule.** Chapter 16 ("বিয়োগ" / Subtraction, textbook pages 101-104, 4 lessons — declared count matched actual) covers two-digit subtraction without borrowing (larger number ≤99), both vertical and horizontal formats, ending with word problems. Chapter 17 ("(বাংলাদেশি মুদ্রা)" / Bangladeshi Currency, textbook pages 105-108, 2 lessons — declared count matched actual) covers recognizing coins/notes up to 100 taka and role-played transactions/change-making. Chapter 18 ("নিজে করি" / Self-Practice — Final Review, textbook pages 109-114, 6 lessons) is the book's closing cumulative review chapter (guide ends with "সমাপ্ত" on PDF page index 181) — unlike other chapters it has no per-lesson topic/LO breakdown in the source, only page/item ranges (items 1-28) under one shared assessment rubric covering addition-subtraction, geometry, and pattern; transcribed faithfully to that structure rather than inventing per-lesson specifics not present in the source. **Note from Chapter 5: its stated "পাঠ সংখ্যা" header undercounted (said 11, actually 13) — don't trust that figure as an early-stop signal, keep reading until a new "অধ্যায়" (chapter) header actually appears.** Next subject to tackle for Class One: Bangla, English, Social & Elementary Science, Physical & Mental Health, Arts, or one of the religion subjects (links above).

### Delegation note (added when context grew large mid-extraction)

Each rendered page-image costs ~1,200-2,000 tokens read directly in a
conversation; a chapter (5-20 pages) costs ~10K-40K tokens. To avoid one
conversation thread ballooning across dozens of chapters/subjects/classes,
**remaining chapters should be delegated to background subagents** (Sonnet,
not Haiku — accuracy on legacy Bijoy-font Bangla OCR and catching source
inconsistencies, like Chapter 5's undercounted lesson total, matters more
than cost here). Each subagent gets a fresh context budget, does its own
render→read→transcribe→insert cycle following the exact pattern established
in `scratchpad/insert_ch*.js` (Node script writing directly to
`lesson_curricula` via the Supabase REST API using `.env.local`'s service
key), and reports back only a short summary — keeping the orchestrating
thread small regardless of how many chapters/subjects/classes remain.
  - [~] **English (English for Today) — IN PROGRESS.** Source: TG `D:\NCTB books\Class One\English Version\English - Teacher's Guide.pdf` (182 pages) + TB `...\English - Textbook.pdf` (98 pages), both plain English text (not Bijoy-Bangla — TG instructional prose is Bangla but activity content is English, textbook is pure English), much easier to read than Math. **Important subject-tag correction vs Math**: `lesson_curricula.subject` must be `'English for Today'`, not `'English'` — the Lesson Plan form's Subject dropdown and AI-draft book-URL resolution both key off `NCTB_BOOKS[className]` entries verbatim (`app.js` `_lpSubjectOptionsList`/`_lpGenerateWithAi`), and Class One's NCTB_BOOKS entry is literally `'English for Today'`.
    - **Source structure differs from Math**: the TG itself has a printed Table of Contents (PDF pages 5-8, i.e. `pages="5-8"` via Read tool's native PDF support, or PNGs already rendered to `scratchpad/tg_english_pages/p005.png`-`p008.png`) laying out **5 Units → Lessons → Sessions**, each Session citing its own TG page and (lesson-level) textbook page range. Total per TOC's own tally: **5 Units, 40 Lessons, 100 Sessions**. Given Sessions are the actual single-classroom-period granularity (each with its own Learning Outcome, Teaching aids, 50-minute procedure block, and Assessment Indicators table) — analogous to Math's per-পাঠ granularity — **one `lecture_number` = one Session**, not one Lesson (a Lesson can span 2-4 Sessions/textbook-page-letters, e.g. Lesson 2 "aA-bB" = 4 sessions across pages 13-16). `chapter` = one row per **Unit** (5 rows total for the whole subject, matching Math's one-row-per-chapter pattern).
    - **Page-index offsets confirmed** (needed for `pymupdf` rendering or Read tool's PDF `pages` param): TG PDF index = printed page number + 8 (e.g. printed page 5 = PDF index 13). TB PDF index = printed page number + 4 (printed page 2 = PDF index 6).
    - **Gotcha specific to English, confirmed on TG printed page 2**: only the Alphabet-`aA/bB` lesson (Unit 2 Lesson 2) has its Teaching-Learning-Activity steps written out in full; NCTB explicitly abbreviates the remaining 19 alphabet lessons (cC-dD, eE-fF, gG-hH, ... xX-zZ) "to reduce the guide's bulk", telling teachers to cross-reference Lesson 2 for procedural detail. Expect those TG entries to be genuinely short (Session/LO/Teaching-aids header + a couple of sentences) — that's the source being brief, not a reading error; don't pad elaborate_summary with invented detail.
    - **Unit 1 (Greetings and Farewells) — COMPLETE, live as id 19, 9/9 sessions** (6 Lessons: Good Morning (1)&(2), How Are You? (1)&(2), Goodbye, Two Little Blackbirds — the last split into 2 sessions). Both `elaborate_summary` (TG) and `textbook_context` (TB) populated for all 9. TG PDF pages read: 13-26 (printed pages 5-18). TB PDF pages read: 6-14 (printed pages 2-10).
    - **Units 2-5 delegated to background subagents** (per the delegation note below) to keep this orchestrating thread's context small — Unit 2 "Alphabet and Numbers" alone is 21 Lessons / ~60 Sessions spanning TG printed pages 19-139 (121 pages) and TB pages 12-63, by far the largest unit in the book; Units 3 (Classroom Instructions, 3 lessons), 4 (Questions and Answers, 6 lessons), and 5 (Rhymes and Sounds, 3 lessons) are small (TG printed pages 141-171, ~30 pages total) and were bundled into one subagent. **If interrupted, resume point is whichever of these units' subagent didn't report a completed insert** — check `lesson_curricula` for `subject='English for Today'` rows beyond id 19 to see which Units (2/3/4/5) actually landed, since subagents insert immediately per completed chapter.
  - [ ] Bangla, Social & Elementary Science, Physical & Mental Health, Arts, Islamic Studies, Hindu Religion, Christian Religion, Buddhist Religion — not started
- [ ] Class Two — subject list not yet fetched (page link known: 69afb81aa52ffd47032d0757)
- [ ] Class Three — subject list not yet fetched (page link known: 69afb842138848bf0fa5e79b)
- [ ] Class Four — subject list not yet fetched (page link known: 69afb8a7e79e59e52d1be566)
- [ ] Class Five — subject list not yet fetched (page link known: 69afb8d3a938e1f3ef6312d0)
- [ ] Class Six–Eight — blocked on source discovery
- [ ] Class Nine-Ten — blocked on source discovery

### Verified working end-to-end

Confirmed the full pipeline works correctly with real data: downloaded the
Mathematics TG → rendered pages → read via vision → transcribed 2 chapters
(8 lessons, with page numbers and learning outcomes) → inserted into
`teacher.lesson_curricula` via direct Supabase REST POST → verified
queryable back out. This data is now live — the Lesson Plan form's Chapter
dropdown for Class One + Mathematics + Bangla Version shows these 2
chapters today, with real checkbox lesson lists and auto-filled learning
outcomes. The remaining work is purely repetition of this same proven
process across many more chapters/subjects/classes.
