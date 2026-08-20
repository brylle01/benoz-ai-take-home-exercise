# Starter package — Platform Foundation take-home

```
review/
  handover-architecture.md   <- Part 1: the contractor's handover notes
lib/
  validate.js                <- the validation library
clients/
  client-a-city-maintenance.json
  client-b-grant-foundation.json
  client-c-clinic.json       <- field definitions for the three live clients
test/
  validate.test.js           <- the original per-field suite (unchanged)
  cross-field.test.js        <- tests for the cross-field rules added here
submission/                  <- the write-ups for Parts 1–4
site/                        <- the React + Tailwind page that publishes them
package.json
```

## Running it

Node 18+, no dependencies to install.

```
npm test
```

That runs both suites (`node --test test/`). All 47 tests pass. The 16 original
tests in `test/validate.test.js` are untouched — no existing behavior changed.

---

# Cross-field validation

The library validates a **record** against a **definition**. Until now every check
looked at one field in isolation, so a rule like *"the project end date must not be
before the project start date"* had nowhere to live except an `if` statement in
application code.

A definition now has a second, optional top-level key: **`rules`**.

```json
{
  "fields": [
    { "name": "project_start_date", "label": "Project start date", "type": "date", "required": true },
    { "name": "project_end_date",   "label": "Project end date",   "type": "date", "required": true }
  ],
  "rules": [
    {
      "id": "end_date_not_before_start_date",
      "assert": { "field": "project_end_date", "op": "gte", "other_field": "project_start_date" },
      "error": {
        "field": "project_end_date",
        "message": "Project end date must not be before the project start date"
      }
    }
  ]
}
```

That is the whole worked example. It is live in
`clients/client-b-grant-foundation.json`.

## Why `rules` sits at the top level

A cross-field rule does not belong to a field. Hanging it off `project_end_date`
would imply the error always attaches there, and would hide the rule from anyone
reading `project_start_date` — the field they are about to change. One list at the
top level is the single place to read all of a client's cross-field logic.

## The shape of a rule

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within the definition. Appears on the error, so support can trace a message back to the rule that produced it. |
| `assert` | yes | A **condition**. The record is valid when this is true. |
| `when` | no | A **condition** guarding the rule. If it is false, the rule does not apply and nothing is reported. |
| `error.message` | yes | The sentence a person reads. Written by whoever writes the rule — the library never invents wording. |
| `error.field` | usually no | Which field the error attaches to. Defaults to `assert.field`. |

Read a rule as a sentence: **when** *guard*, **assert** *condition*, otherwise say
*message* against *field*.

## The shape of a condition

`when` and `assert` use the same grammar, so there is one thing to learn, used in
two places. A condition is either a **comparison** or a **combinator**.

### Comparison

```json
{ "field": "<name>", "op": "<operator>", "value": <literal> }
{ "field": "<name>", "op": "<operator>", "other_field": "<name>" }
{ "field": "<name>", "op": "present" }
```

- `field` — the field being checked. Always a field `name`, never a label.
- `value` — compare against a literal written into the definition.
- `other_field` — compare against another field's submitted value. **This is how a
  rule refers to another field.**
- Comparison operators need **exactly one** of `value` or `other_field`.
  `present`/`absent` take **neither**.

### Operators

| Operator | Works on | Meaning |
|---|---|---|
| `eq`, `neq` | any scalar | Strict equality / inequality. |
| `lt`, `lte`, `gt`, `gte` | `number`, and `date`/`text`/`long_text`/`choice` | Ordering. Numbers compare numerically, strings lexicographically. |
| `in`, `not_in` | any scalar | Is the value one of a list? `value` is a list literal, or `other_field` is a `multi_choice` field. |
| `contains`, `not_contains` | `multi_choice` | Does the selected list include this option? |
| `present`, `absent` | any | Was the field filled in? Same emptiness test as `required`: `null`, `undefined`, `""`, whitespace, and `[]` all count as empty. |

`date` fields compare with `lt`/`gte`/etc. because `YYYY-MM-DD` is zero-padded, so
a date sorts identically as text and as a calendar date. No parsing, no timezone,
no daylight-saving edge case.

There is no `not`. Every operator has an explicit negation, which keeps conditions
readable as English rather than as nested logic.

### Combinator

```json
{ "all_of": [ <condition>, <condition>, ... ] }
{ "any_of": [ <condition>, <condition>, ... ] }
```

Combinators nest. Nesting is allowed because it costs nothing to describe or
implement; what is *not* allowed is anything that computes a new value (see
[Where I stopped](#where-i-stopped)).

## Writing a new rule

1. **State it as a sentence.** "When the priority area includes health, a clinical
   lead is required."
2. **The `assert` is the part after the comma** — the thing that must be true.
   `{ "field": "clinical_lead", "op": "present" }`
3. **The `when` is the part before it**, if there is one.
   `{ "field": "priority_areas", "op": "contains", "value": "health" }`
4. **Write the message the way you would say it to the person filling in the form.**
5. **Leave `error.field` out** unless the field to blame is not `assert.field`.
6. **Run `validateDefinition`** — it will tell you if you mistyped a field name or
   compared two things that cannot be compared.

```json
{
  "id": "health_needs_a_clinical_lead",
  "when":   { "field": "priority_areas", "op": "contains", "value": "health" },
  "assert": { "field": "clinical_lead",  "op": "present" },
  "error":  { "message": "Name a clinical lead when health is a priority area" }
}
```

Two more shapes worth having seen:

```json
// At least one of two fields. A combinator has no subject, so error.field is required.
{
  "id": "one_contact_method",
  "assert": { "any_of": [
    { "field": "phone", "op": "present" },
    { "field": "email", "op": "present" }
  ]},
  "error": { "field": "phone", "message": "Give either a phone number or an email address" }
}

// A guard on a combination, and an error deliberately aimed elsewhere.
{
  "id": "justify_large_expedited_request",
  "when": { "all_of": [
    { "field": "expedited", "op": "eq",  "value": true },
    { "field": "amount",    "op": "gt",  "other_field": "ceiling" }
  ]},
  "assert": { "field": "justification", "op": "present" },
  "error":  { "message": "Justify an expedited request above the ceiling" }
}
```

---

## The three decisions the task asks about

### 1. Which field the error is reported against

**The subject of the `assert` — the field named in `assert.field` — unless
`error.field` overrides it.**

If `project_end_date` must be `gte` `project_start_date`, the error goes on
`project_end_date`. The rule is grammatically *about* the end date; the start date
appears as the thing it is measured against. That matches what the person filling
in the form has to do: one field is highlighted, and it is the one to change.

The override exists because the grammar cannot always guess. If the form asks for
the end date first, blaming the start date may be the kinder choice, and
`"error": { "field": "project_start_date", ... }` says so.

**One rule produces at most one error, and it never attaches to two fields.**
Highlighting both ends of a comparison tells the user there are two problems when
there is one, and leaves them unsure which to edit. If a client genuinely wants
both highlighted, that is two rules with two messages — which forces the author to
write two sentences that each make sense on their own, and usually reveals that
only one of them did.

### 2. What happens when a dependency is missing or invalid

**A rule runs only if every field it reads is *usable*. Otherwise it is skipped,
silently.** A field is usable when both hold:

- it is **present** (unless it is only being tested with `present`/`absent`), and
- it produced **no per-field error** in phase 1.

The consequences, spelled out:

| Situation | What happens |
|---|---|
| Dependency missing, and `required` | Phase 1 already emitted "X is required". The rule is skipped. One error, on the empty field. |
| Dependency missing, and optional | The rule is skipped. Nothing is reported. |
| Dependency present but malformed (e.g. a date as `15/01/2027`) | Phase 1 emitted a format error. The rule is skipped. |
| The rule's own `assert.field` is missing | Skipped — **except** under `present`/`absent`, which are *about* emptiness and therefore always run. |
| `when` guard is false, or cannot be evaluated | The rule does not apply. Nothing reported. |

**Why skip rather than fail.** A rule states a relationship between values. If a
value is absent or known to be malformed, the relationship has no truth value —
`"15/01/2027" >= "2027-12-15"` is not false, it is meaningless. Reporting a failure
would put a second, derived error on a field the user cannot fix, and would blame
the wrong one: they must fix the malformed start date, and being told the end date
is also wrong sends them to edit a field that is fine.

Failing would also quietly change what `required` means. For two optional dates, a
cross-field rule that fired on absence would make filling in one of them compulsory
— a requirement the definition never declared and nobody could see.

**Why silently.** The user is not owed a message about a check that did not run;
they already have a message about the field that stopped it. Silence here is only
safe because the *unsafe* silences are excluded: a malformed rule, an unknown
operator, or two operands that cannot be compared are all reported loudly rather
than skipped, because a rule that always passes is worse than no rule at all.

**A corollary worth relying on: rules are order-independent.** They read phase 1's
results and the record, never each other's outcomes. Reordering the `rules` array
cannot change the result, and every rule that can run does — the phase does not
stop at the first failure, so a user sees all their problems at once.

### 3. Where I stopped

**The line: a rule can *read and compare* submitted values. It can never *compute*
a new one.**

Inside the line — comparison between two fields, comparison against a literal,
membership, presence, and boolean combinations of those. That covers the cases
these three clients and their briefs actually produce: date ordering, numeric
ranges (`min`/`max` as two fields), required-if-another-field-equals, required-if-a
multi-choice-includes, and at-least-one-of.

Outside the line, deliberately:

- **Arithmetic.** No "these three fields must sum to the total", no "end date must
  be within 90 days of start". Both need an expression evaluator, and the moment a
  definition contains an expression, the definition is a program: it needs a
  parser, a precedence table, its own error messages, and a security review of
  what a client-authored expression may reach.
- **`not`.** Every operator has a negation, so a general `not` adds nesting and no
  expressive power.
- **Cross-record and cross-table lookups.** "This licence number must exist in the
  registry" is a different kind of check — it needs I/O, it can fail for reasons
  that are not the user's fault, and it cannot be answered synchronously from the
  record in hand.
- **Rules depending on other rules' outcomes.** That introduces ordering, and with
  it cycles.

**The test for the boundary:** every rule in this format can be read aloud as one
English sentence by someone who has never seen the format. `when priority_areas
contains health, clinical_lead must be present` passes. `when (amount * 1.15) >
(ceiling - reserve)` does not. When a client needs the second kind, the honest
answer is a named validator in code that the definition invokes by name — a small,
reviewed, testable extension point — not a slightly bigger expression language
that will need extending again next month.

**What I would add first if pushed**, in order: a `date_within` style operator with
an explicit unit (the most-requested rule this format can't express), then named
validators as the escape hatch. Both are additive; neither changes anything above.

---

## Definitions are data, so this is the compiler

Rules ship as JSON. JSON has no compiler, so a mistyped field name would otherwise
surface as a rule that silently never fires. `validateDefinition(definition)`
closes that gap and should run wherever a definition is authored or loaded:

```js
const { validateDefinition } = require("./lib/validate");

const result = validateDefinition(definition);
// { valid: false, errors: [{ rule: "typo", message: '`assert` references unknown field "start_on"' }] }
```

It catches unknown field names, unknown operators, duplicate rule ids, a missing
`error.message`, giving both `value` and `other_field` (or neither), giving an
operand to `present`/`absent`, a combinator `assert` with no `error.field`,
`contains` on a field that is not a `multi_choice`, and ordering comparisons
between types that cannot be ordered — `date` against `number`, for instance.

## API

```js
const { validateRecord, validateDefinition } = require("./lib/validate");

validateRecord(definition, record);
// -> { valid: boolean, errors: [{ field, message, rule? }] }
```

`errors` is unchanged in shape. Errors from cross-field rules carry an extra
`rule` key naming the rule that produced them; per-field errors do not. Existing
callers that read `field` and `message` are unaffected, and a definition with no
`rules` key behaves exactly as it did before.

## Constraints the task set, and how they are met

- **Existing tests pass unchanged.** All 16, with no edits to
  `test/validate.test.js` and no behavior change to any existing path.
- **New tests cover the awkward cases**, not just the happy path: missing required
  dependency, missing optional dependency, malformed dependency, malformed subject,
  guard that cannot be evaluated, unknown operator, rule with nowhere to report,
  order-independence, and every `validateDefinition` failure above.
  See `test/cross-field.test.js`.
- **`lib/` stays client-agnostic.** No client names and no client-specific field
  names anywhere in `lib/validate.js`. The one worked rule lives in
  `clients/client-b-grant-foundation.json`, where the other client-specific data is.
