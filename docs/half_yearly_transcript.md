# Academic Transcript — Half Yearly

Written for: whoever maintains the exam module (you, or me in a later session).

This is the saved result template that prints the school's Half Yearly
transcript, the one on the printed sheet from Class Six. It lives in
`exam.result_templates` under the name **Academic Transcript — Half Yearly**,
and it is rebuilt by running `scripts/build_transcript_template.js`.

## How a subject's marks add up

Each subject's line on the transcript comes from **two exams in the same term**:

| Printed column | Where it comes from |
|---|---|
| Full Marks | the subject's full marks after weighting: CT 20 × 100% + written 100 × 80% = 100 |
| CT Total / CT Obt. / CT Conv. | the **CT-1** exam's CT part: its full marks, the marks given, and marks × weight |
| MCQ, CQ, Prac | the **Half Yearly** exam's parts |
| Total | those three added up, before weighting (66) |
| Conv. | the same after weighting, 66 × 80% = 52.80 |
| Total Marks | CT Conv. + Conv. = 9 + 52.80 = 61.80 |
| Highest Marks | the best Total Marks in that class for the subject |
| Letter Grade / Grade Point | from Grade Setup, using Total Marks ÷ Full Marks |

So the weights live in **Subject Setup**, not in the template: CT at 100%, CQ
and MCQ at 80%. ICT on the printed sheet converts CT at 50% (16 → 8), which is
just ICT's own CT weight for that class.

## GPA

GPA counts **1st and 2nd papers as one subject** (their marks add together) and
**leaves out a subject nobody sat** (Arts & Crafts on the printed sheet). That is
why the sheet shows 27.00 total grade points over 7 subjects = 3.86, even though
9 subject lines are printed. Two switches in the template control this:

- `gpa_pair_papers: true` — pair "X 1st Paper" with "X 2nd Paper"
- `gpa_skip_empty: true` — skip a subject with no marks
- `gpa_exclude: [subject ids]` — leave particular subjects out, if ever needed

## What the template contains

- **Exams**: term "Half Yearly Exam 2026" → `CT-1 2026` and `Half Yearly 2026`.
  They are matched by **name**, so the same template works for every class.
- **Combining**: `method: 'sum'` — the two exams' marks add together; each part
  already carries its own weight.
- **Classes**: Six, Seven, Eight, Nine (Science, Business Studies) and Ten
  (Science, Business Studies). The template only appears for those.
- **Attendance**: 1 Jan 2026 – 30 Jun 2026, which fills Present Days, Working
  Days and Present %.
- **Report card** (Legal landscape, 356 × 216 mm): heading, student details,
  photo, grade key, the 14-column marks table across the full width, totals,
  three summary boxes (result, attendance, merit position), a remarks box and
  four signatures along the foot.
- **Tabulation sheet** (Legal landscape): every student as a row, each subject's
  marks and grade, then Total, Total GP, GPA, Grade and Result.

## Using it

Exams → Result Process → pick the template → pick the class → **Prepare Result**,
then **Print Report Cards** or **Print Tabulation**.

## Rebuilding it

```
node scripts/build_transcript_template.js
```

It replaces the template of the same name, so edits made in the designer are
overwritten. Edit the script's `marksItems`, `student.blocks` or `cols` to change
what is printed; positions are millimetres on the page.

## Still to set by hand

1. **Signatures** — the Vice Principal and Principal blocks are empty. Open
   Design Sheet, click a signature block, upload the image, and add rules if a
   different signature is needed per class (e.g. class in Eleven, Twelve → the
   college VP).
2. **Previous Result** — printed as a fixed `0.00`; there is no store of last
   term's GPA yet.
3. **Grade Setup** — the scale was seeded to match the sheet: A+ 80–100 (5.00),
   A 70–79 (4.00), A- 60–69 (3.50), B 50–59 (3.00), C 45–49 (2.00), F 0–44 (0).
4. **Marks** must be entered in both exams; a subject with no marks prints blank.

## Column widths

Table columns size themselves unless you say otherwise. To set one:

- **Marks table** (Design Sheet → the block → Columns): each line is
  `Header | value | group | align | decimals | width`. A plain number is a
  percentage of the table, `18mm` is an exact width, blank stays automatic.
- **Static tables** (the result / attendance / merit boxes): the block's
  **Column widths** box, e.g. `40 | 60`.
- **Tabulation sheet**: the width box in each column's row in the column
  builder (Result Process → Columns).

In `scripts/build_transcript_template.js` the same thing is a `width` on a
`marksItems` entry, e.g. `{ id: 'm1', label: 'Subjects', path: 'name', align: 'left', width: '16' }`.
Once any column in a table has a width, the table uses a fixed layout and the
columns left blank share whatever is left.
