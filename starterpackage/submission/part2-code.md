# Part 2 — The code

**Repository: <https://github.com/brylle01/benoz-ai-take-home-exercise>

Cross-field validation, added to both the definition format and the library, so a
rule like *"the project end date must not be before the project start date"* is
**declared as data** rather than written as an `if` statement in application code.

The full format specification is in [`README.md`](https://github.com/brylle01/benoz-ai-take-home-exercise/blob/main/starterpackage/README.md) —
precise enough to write a new rule from without reading the code. What follows is
the short version.

```
lib/validate.js            validateRecord + validateDefinition
clients/*.json             the three client definitions; client B carries the worked rule
test/validate.test.js      the original 16 tests — untouched, still passing
test/cross-field.test.js   31 new tests for the rules and their edge cases
README.md                  the format spec
```

```bash
npm test    # 47 tests, no dependencies, Node 18+
```

## The format

A definition gains one optional top-level key, `rules`, alongside `fields`:

```json
{
  "id": "end_date_not_before_start_date",
  "assert": { "field": "project_end_date", "op": "gte", "other_field": "project_start_date" },
  "error": {
    "field": "project_end_date",
    "message": "Project end date must not be before the project start date"
  }
}
```

Read as a sentence: **when** *(optional guard)*, **assert** *this condition*,
otherwise report *this message* against *this field*.

A rule refers to another field with **`other_field`**, naming it exactly as `fields`
does. `when` and `assert` share one condition grammar — comparison
(`eq`/`neq`/`lt`/`lte`/`gt`/`gte`/`in`/`not_in`/`contains`/`not_contains`/`present`/`absent`)
against either a literal `value` or an `other_field` — plus `all_of`/`any_of` to
combine them. One grammar, two slots, nothing else to learn.

Rules live at the **top level**, not on a field, because a cross-field rule is not
owned by either field it touches. Hanging it off `project_end_date` would hide it
from whoever is reading `project_start_date` — the field they are about to change.

## The three judgment calls

**Which field gets the error.** The subject of the `assert` — the field the rule is
grammatically *about*, and the one the user has to change. `error.field` overrides
it when the form's ordering makes the other field the kinder place to complain.
One rule produces at most one error, never two: highlighting both ends of a
comparison tells the user there are two problems when there is one.

**When a dependency is missing or invalid.** A rule runs only if every field it
reads is *usable* — present, and free of per-field errors. Otherwise it is skipped,
silently. A relationship between values has no truth value when one value is absent
or malformed; `"15/01/2027" >= "2027-12-15"` is not false, it is meaningless.
Reporting it would put a second error on a field the user cannot fix and send them
to edit the wrong one. `present`/`absent` are the carve-out — they are *about*
emptiness, which is what makes "required if" expressible.

The silence is bounded. A malformed rule, an unknown operator, or two operands that
cannot be compared are all reported **loudly**, because a rule that always passes is
worse than no rule at all.

**Where I stopped.** A rule can *read and compare* submitted values. It can never
*compute* a new one. No arithmetic, no "within 90 days", no cross-record lookups,
no rules that depend on other rules. The test: every rule in this format reads
aloud as one English sentence. `when priority_areas contains health, clinical_lead
must be present` passes; `when (amount * 1.15) > (ceiling - reserve)` does not —
that is an expression evaluator, and a definition containing an expression is a
program. When a client needs that, the honest answer is a named validator in code
invoked by name from the definition, not a slightly larger expression language that
needs extending again next month.

## Two things I added that weren't asked for

**`validateDefinition(definition)`.** Rules ship as JSON, and JSON has no compiler —
so a mistyped field name would otherwise surface as a rule that silently never
fires, which is the exact failure mode this whole design is trying to avoid. It
catches unknown field references, unknown operators, duplicate ids, missing
messages, malformed operands, and ordering comparisons between incomparable types
(`date` against `number`). Run it where definitions are authored, so the typo is
caught by the person writing the rule rather than the person filling in the form.

**Order-independence as a guarantee.** Rules read phase 1's results and the record,
never each other's outcomes. Reordering the `rules` array cannot change the result,
and every rule that can run does — so the user sees all their problems at once
rather than one per submit. There is a test asserting it.

## Compatibility

No existing behavior changed. All 16 original tests pass with `test/validate.test.js`
unedited. `errors` keeps its `{ field, message }` shape; rule errors carry an extra
`rule` key naming what produced them, which existing callers ignore. A definition
with no `rules` key behaves exactly as before. `lib/` remains client-agnostic — no
client names, no client-specific field names.
