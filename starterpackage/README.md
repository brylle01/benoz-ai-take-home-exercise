# Starter package — Platform Foundation take-home

This is the material referenced in Parts 1 and 2 of the exercise brief.

```
review/
  handover-architecture.md   <- Part 1: the contractor's handover notes
lib/
  validate.js                <- the validation library (Part 2 starting point)
clients/
  client-a-city-maintenance.json
  client-b-grant-foundation.json
  client-c-clinic.json       <- field definitions for the three live clients
test/
  validate.test.js           <- the existing passing test suite
package.json
```

## Running it

Node 18+, no dependencies to install.

```
npm test
```

That runs the existing suite (`node --test test/validate.test.js`). It should pass as-is, out of the box, before you change anything.

## What's here

`lib/validate.js` exports `validateRecord(definition, record)`. A **definition** is a list of field descriptions (name, label, type, required, options for choice-like fields, and a `constraints` object); a **record** is the plain object of submitted values. It returns `{ valid, errors }`, where `errors` is a list of `{ field, message }`.

Supported field types today: `text`, `long_text`, `number`, `boolean`, `date` (`YYYY-MM-DD`), `choice`, `multi_choice`, `file`. Supported constraints vary by type: `min_length`/`max_length`/`pattern` for text, `min`/`max` for numbers, `min_selected`/`max_selected` for multi-choice, `accepted` (a list of extensions) for files. Look at `clients/*.json` for real examples of all of these in use, and `test/validate.test.js` for what each one rejects.

The three client definition files are the actual field lists for the three clients described in the brief (Client A / City maintenance, Client B / Grant-making foundation, Client C / Private clinic) — field names match what the brief describes. They're here so you have real, non-trivial definitions to test against rather than inventing your own.

**What the library does *not* do yet: cross-field validation.** Every check today looks at exactly one field in isolation. There's no way, today, to express "the project end date must not be before the project start date" — that rule spans two fields, and nothing in the current format has a place to put it.

## The task

Add cross-field validation to both the definition format and the library, so a rule like the one above can be **declared as data**, not written as a one-off `if` statement in application code.

There's no single right answer here — that's deliberate. You'll need to decide (and this is the part we actually care about):

- **How a rule refers to another field.** What does the declaration look like? How does it name the field(s) it depends on?
- **Which field the error is reported against.** If `project_end_date` is before `project_start_date`, does the error attach to the end date, the start date, or both? Pick one and say why.
- **What happens when a dependency is missing.** If a rule needs `project_start_date` and it wasn't submitted (or itself failed its own per-field validation), does the cross-field rule still run? Silently pass? Silently fail? This should be a deliberate choice, not whatever happens to fall out of the code.
- **Where you decided to stop.** A single date-comparison rule is easy to hardcode. A rule engine that can express arbitrary logic is a project. Somewhere between those is a boundary that covers real cases without turning the definition format into a programming language — where you draw that line, and why, matters more than how much you built.

Write all of this up in this README (replace this section, or add to it — your call), precisely enough that someone else could implement a new cross-field rule correctly from your description alone, without reading your code first.

**Constraints on the implementation:**

- The existing tests in `test/validate.test.js` must still pass. If you change the behavior of an existing test, say why in your writeup.
- Add tests for your new behavior, including the awkward cases above (missing dependency, invalid dependency, etc.) — not just the happy path.
- Keep `lib/` client-agnostic: no client names, and no client-specific field names, anywhere in `lib/`. The three files under `clients/` are examples/fixtures, not part of the library.

We'll take your documented format and, after you submit, write a cross-field rule against a client and field set you haven't seen, following only your README. If we can write that rule correctly from your description, and your code handles it, that's the bar.
