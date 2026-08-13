# NCTB Curriculum Extraction — chapter → lesson → learning-outcome data

## Purpose

Populate `teacher.lesson_curricula` (one row per Class+Subject+Version+Chapter,
a `lectures` jsonb array of `{lecture_number, topic, learning_outcome,
page_number, elaborate_summary}`) with the *official* NCTB breakdown for
every class × subject, so the Lesson Plan module's Chapter/Lesson(s) picker
and the AI draft generator have real data to work from instead of staying
empty until teachers type it in one plan at a time.

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
3. Transcribe chapter headings, lesson numbers (পাঠ-১, পাঠ-২...), topics,
   learning outcomes, page numbers, and (for Math/Physics/Chemistry) any
   equations, into:
   ```json
   { "chapter": "...", "lectures": [
     { "lecture_number": 1, "topic": "...", "learning_outcome": "...",
       "page_number": "12", "elaborate_summary": "..." }
   ]}
   ```
4. Load into `teacher.lesson_curricula` via the same insert path
   `saveLessonCurriculum` uses (class_name/subject/version/chapter/lectures/
   is_editable) — either through the existing UI form one chapter at a time,
   or a one-off seed script hitting the Supabase REST endpoint directly for
   bulk loading once a whole subject's data is transcribed.
5. Check off progress below.

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
  - [ ] Bangla, English, Social & Elementary Science, Physical & Mental Health, Arts, Islamic Studies, Hindu Religion, Christian Religion, Buddhist Religion — not started
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
