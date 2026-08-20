"use strict";

/**
 * Field-definition-driven record validator.
 *
 * A "definition" is:
 *   {
 *     fields: [ { name, label, type, required, options?, constraints? }, ... ],
 *     rules?: [ { id, when?, assert, error }, ... ]          <- cross-field rules
 *   }
 *
 * A "record" is a plain object of { fieldName: value }.
 *
 *   validateRecord(definition, record) -> { valid, errors: [{ field, message, rule? }] }
 *   validateDefinition(definition)     -> { valid, errors: [{ message, rule? }] }
 *
 * Validation runs in two phases:
 *   1. per-field   — type and constraints, one field at a time.
 *   2. cross-field — the declarative rules in `definition.rules`.
 *
 * A rule runs only when every field it depends on came out of phase 1 usable:
 * present, and free of per-field errors. Otherwise the rule is skipped in
 * silence, because a rule cannot say anything true about a value that is
 * missing or already known to be malformed. See README.md for the full spec.
 *
 * This module is deliberately client-agnostic: it knows nothing about any
 * particular client, its field names, or its business rules. It only knows the
 * generic type / constraint / operator vocabulary below.
 */

function isPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function fieldLabel(field) {
  return field.label || field.name;
}

// ---------------------------------------------------------------------------
// Phase 1 — per-field validation
// ---------------------------------------------------------------------------

function validateText(field, value, errors) {
  if (typeof value !== "string") {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be a string` });
    return;
  }
  const c = field.constraints || {};
  if (typeof c.min_length === "number" && value.length < c.min_length) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be at least ${c.min_length} characters` });
  }
  if (typeof c.max_length === "number" && value.length > c.max_length) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be at most ${c.max_length} characters` });
  }
  if (c.pattern) {
    const re = c.pattern instanceof RegExp ? c.pattern : new RegExp(c.pattern);
    if (!re.test(value)) {
      errors.push({ field: field.name, message: `${fieldLabel(field)} does not match the required format` });
    }
  }
}

function validateLongText(field, value, errors) {
  // long_text behaves like text but is not typically pattern-constrained.
  validateText(field, value, errors);
}

function validateNumber(field, value, errors) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be a number` });
    return;
  }
  const c = field.constraints || {};
  if (typeof c.min === "number" && value < c.min) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be at least ${c.min}` });
  }
  if (typeof c.max === "number" && value > c.max) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be at most ${c.max}` });
  }
}

function validateBoolean(field, value, errors) {
  if (typeof value !== "boolean") {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be true or false` });
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(field, value, errors) {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be a date in YYYY-MM-DD format` });
    return;
  }
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} is not a valid date` });
  }
}

function validateChoice(field, value, errors) {
  if (typeof value !== "string") {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be one of the allowed options` });
    return;
  }
  const options = field.options || [];
  if (!options.includes(value)) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be one of: ${options.join(", ")}` });
  }
}

function validateMultiChoice(field, value, errors) {
  if (!Array.isArray(value)) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be a list of options` });
    return;
  }
  const options = field.options || [];
  const invalid = value.filter((v) => !options.includes(v));
  if (invalid.length > 0) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} contains invalid option(s): ${invalid.join(", ")}` });
  }
  const c = field.constraints || {};
  if (typeof c.min_selected === "number" && value.length < c.min_selected) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} requires at least ${c.min_selected} selection(s)` });
  }
  if (typeof c.max_selected === "number" && value.length > c.max_selected) {
    errors.push({ field: field.name, message: `${fieldLabel(field)} allows at most ${c.max_selected} selection(s)` });
  }
}

function validateFile(field, value, errors) {
  if (typeof value !== "object" || value === null || typeof value.filename !== "string") {
    errors.push({ field: field.name, message: `${fieldLabel(field)} must be a file with a filename` });
    return;
  }
  const c = field.constraints || {};
  if (Array.isArray(c.accepted) && c.accepted.length > 0) {
    const ext = value.filename.split(".").pop().toLowerCase();
    if (!c.accepted.map((e) => e.toLowerCase()).includes(ext)) {
      errors.push({ field: field.name, message: `${fieldLabel(field)} must be one of: ${c.accepted.join(", ")}` });
    }
  }
}

const TYPE_VALIDATORS = {
  text: validateText,
  long_text: validateLongText,
  number: validateNumber,
  boolean: validateBoolean,
  date: validateDate,
  choice: validateChoice,
  multi_choice: validateMultiChoice,
  file: validateFile,
};

/**
 * How each field type behaves under the cross-field operators. This is what lets
 * `validateDefinition` reject "compare this date against that number" before a
 * definition is ever used, rather than at 2am on a Saturday.
 */
const TYPE_KINDS = {
  text: "string",
  long_text: "string",
  date: "string",
  choice: "string",
  number: "number",
  boolean: "boolean",
  multi_choice: "list",
  file: "object",
};

// ---------------------------------------------------------------------------
// Phase 2 — cross-field rules
// ---------------------------------------------------------------------------

/**
 * Raised when a condition cannot be evaluated as written: an unknown operator, or
 * operands that cannot be ordered against each other. These are faults in the
 * *definition*, not in the record, and `validateDefinition` catches every one of
 * them up front. If one still reaches `validateRecord` it is surfaced loudly,
 * never swallowed into a silent pass.
 */
class RuleError extends Error {}

function describeType(value) {
  if (Array.isArray(value)) return "list";
  if (value === null) return "null";
  return typeof value;
}

/**
 * Ordering for `lt`/`lte`/`gt`/`gte`. Numbers compare numerically; strings compare
 * lexicographically, which is exactly right for the `YYYY-MM-DD` date format — a
 * zero-padded ISO date sorts identically as text and as a calendar date, so date
 * comparison needs no parsing, no timezone, and no ambiguity about what "before"
 * means across a DST boundary.
 */
function orderCompare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  throw new RuleError(`cannot order a ${describeType(a)} against a ${describeType(b)}`);
}

function asList(value, op) {
  if (!Array.isArray(value)) throw new RuleError(`"${op}" needs a list, got a ${describeType(value)}`);
  return value;
}

/** Operators taking one operand: either a literal `value` or another field's value. */
const BINARY_OPS = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  lt: (a, b) => orderCompare(a, b) < 0,
  lte: (a, b) => orderCompare(a, b) <= 0,
  gt: (a, b) => orderCompare(a, b) > 0,
  gte: (a, b) => orderCompare(a, b) >= 0,
  in: (a, b) => asList(b, "in").includes(a),
  not_in: (a, b) => !asList(b, "not_in").includes(a),
  contains: (a, b) => asList(a, "contains").includes(b),
  not_contains: (a, b) => !asList(a, "not_contains").includes(b),
};

/** Operators taking no operand: they ask only whether the field was filled in. */
const UNARY_OPS = {
  present: (a) => isPresent(a),
  absent: (a) => !isPresent(a),
};

const ORDER_OPS = new Set(["lt", "lte", "gt", "gte"]);

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function evaluateCondition(condition, record) {
  if (Array.isArray(condition.all_of)) return condition.all_of.every((c) => evaluateCondition(c, record));
  if (Array.isArray(condition.any_of)) return condition.any_of.some((c) => evaluateCondition(c, record));

  const value = record[condition.field];

  if (has(UNARY_OPS, condition.op)) return UNARY_OPS[condition.op](value);

  const operator = has(BINARY_OPS, condition.op) ? BINARY_OPS[condition.op] : null;
  if (!operator) throw new RuleError(`unknown operator "${condition.op}"`);

  const operand = has(condition, "other_field") ? record[condition.other_field] : condition.value;
  return operator(value, operand);
}

/**
 * Every field a condition reads, and whether it needs a real value to be read.
 * `present`/`absent` are *about* emptiness, so their subject may legitimately be
 * missing — that carve-out is what makes "required if" rules expressible at all.
 */
function conditionDependencies(condition, out = []) {
  if (!condition || typeof condition !== "object") return out;
  for (const key of ["all_of", "any_of"]) {
    if (Array.isArray(condition[key])) {
      for (const child of condition[key]) conditionDependencies(child, out);
      return out;
    }
  }
  const unary = has(UNARY_OPS, condition.op);
  if (typeof condition.field === "string") out.push({ name: condition.field, needsValue: !unary });
  if (typeof condition.other_field === "string") out.push({ name: condition.other_field, needsValue: true });
  return out;
}

/** The field a rule is *about* — the default target for its error. */
function assertSubject(assertion) {
  return assertion && typeof assertion.field === "string" ? assertion.field : null;
}

/**
 * Run every rule in the definition. Rules read phase 1's results and the record,
 * never each other's outcomes, so the result does not depend on the order the
 * rules happen to be declared in.
 */
function runRules(definition, record, fieldErrors) {
  const errors = [];
  const rules = (definition && definition.rules) || [];
  if (!Array.isArray(rules) || rules.length === 0) return errors;

  const alreadyBroken = new Set(fieldErrors.map((e) => e.field));

  for (const [index, rule] of rules.entries()) {
    const id = (rule && rule.id) || `rules[${index}]`;
    const target = (rule && rule.error && rule.error.field) || assertSubject(rule && rule.assert);

    if (!rule || !rule.assert || !target) {
      // A malformed rule is a fault in the definition. Never skip one silently:
      // that turns a broken rule into a rule that always passes.
      errors.push({ field: target || null, message: `Rule "${id}" is malformed and could not be run`, rule: id });
      continue;
    }

    const dependencies = conditionDependencies(rule.when).concat(conditionDependencies(rule.assert));
    const unusable = dependencies.some(
      (d) => alreadyBroken.has(d.name) || (d.needsValue && !isPresent(record[d.name])),
    );
    if (unusable) continue;

    try {
      if (rule.when && !evaluateCondition(rule.when, record)) continue; // guard says the rule does not apply
      if (evaluateCondition(rule.assert, record)) continue; // rule satisfied
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      errors.push({ field: target, message: `Rule "${id}" could not be evaluated: ${err.message}`, rule: id });
      continue;
    }

    errors.push({
      field: target,
      message: (rule.error && rule.error.message) || `Rule "${id}" was not satisfied`,
      rule: id,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a record against a field definition.
 *
 * Phase 1 checks each field on its own. Phase 2 runs the cross-field rules
 * against the fields phase 1 left usable.
 */
function validateRecord(definition, record) {
  const fieldErrors = [];
  const fields = (definition && definition.fields) || [];
  const values = record || {};

  for (const field of fields) {
    const value = values[field.name];
    const present = isPresent(value);

    if (!present) {
      if (field.required) {
        fieldErrors.push({ field: field.name, message: `${fieldLabel(field)} is required` });
      }
      continue; // optional and absent: nothing further to check
    }

    const validator = TYPE_VALIDATORS[field.type];
    if (!validator) {
      fieldErrors.push({ field: field.name, message: `Unknown field type "${field.type}" for ${fieldLabel(field)}` });
      continue;
    }

    validator(field, value, fieldErrors);
  }

  const errors = fieldErrors.concat(runRules(definition, values, fieldErrors));
  return { valid: errors.length === 0, errors };
}

/**
 * Check that a definition is coherent, without any record in hand.
 *
 * Rules are data, and data has no compiler — so this is the compiler. Run it
 * wherever definitions are authored or loaded, so that a typo in a field name is
 * caught by the person writing the rule rather than by the person filling in the
 * form.
 */
function validateDefinition(definition) {
  const errors = [];
  const push = (message, rule) => errors.push(rule ? { rule, message } : { message });

  const fields = (definition && definition.fields) || [];
  const byName = new Map();

  for (const [index, field] of fields.entries()) {
    if (!field || typeof field.name !== "string" || field.name === "") {
      push(`fields[${index}] has no name`);
      continue;
    }
    if (byName.has(field.name)) push(`Duplicate field name "${field.name}"`);
    if (!has(TYPE_VALIDATORS, field.type)) push(`Field "${field.name}" has unknown type "${field.type}"`);
    byName.set(field.name, field);
  }

  const rules = (definition && definition.rules) || [];
  if (!Array.isArray(rules)) {
    push("`rules` must be a list");
    return { valid: false, errors };
  }

  const seenIds = new Set();
  for (const [index, rule] of rules.entries()) {
    const id = (rule && rule.id) || `rules[${index}]`;

    if (!rule || typeof rule !== "object") {
      push("Rule must be an object", id);
      continue;
    }
    if (typeof rule.id !== "string" || rule.id === "") push("Rule needs an `id`", id);
    else if (seenIds.has(rule.id)) push(`Duplicate rule id "${rule.id}"`, id);
    else seenIds.add(rule.id);

    if (!rule.error || typeof rule.error.message !== "string" || rule.error.message === "") {
      push("Rule needs an `error.message` — the sentence a person will read", id);
    }

    if (!rule.assert) {
      push("Rule needs an `assert` condition", id);
      continue;
    }

    const target = (rule.error && rule.error.field) || assertSubject(rule.assert);
    if (!target) {
      push("Rule needs an explicit `error.field`: its `assert` is a combinator, so there is no subject to default to", id);
    } else if (!byName.has(target)) {
      push(`Rule reports its error against unknown field "${target}"`, id);
    }

    if (rule.when) checkCondition(rule.when, "when", id, byName, push);
    checkCondition(rule.assert, "assert", id, byName, push);
  }

  return { valid: errors.length === 0, errors };
}

function checkCondition(condition, slot, ruleId, byName, push) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    push(`\`${slot}\` must be a condition object`, ruleId);
    return;
  }

  for (const key of ["all_of", "any_of"]) {
    if (has(condition, key)) {
      if (!Array.isArray(condition[key]) || condition[key].length === 0) {
        push(`\`${slot}.${key}\` must be a non-empty list of conditions`, ruleId);
      } else {
        for (const child of condition[key]) checkCondition(child, `${slot}.${key}`, ruleId, byName, push);
      }
      return;
    }
  }

  const unary = has(UNARY_OPS, condition.op);
  const binary = has(BINARY_OPS, condition.op);
  if (!unary && !binary) {
    push(`\`${slot}\` uses unknown operator "${condition.op}"`, ruleId);
    return;
  }

  if (typeof condition.field !== "string") {
    push(`\`${slot}\` needs a \`field\``, ruleId);
    return;
  }
  const subject = byName.get(condition.field);
  if (!subject) {
    push(`\`${slot}\` references unknown field "${condition.field}"`, ruleId);
    return;
  }

  const hasValue = has(condition, "value");
  const hasOther = has(condition, "other_field");

  if (unary) {
    if (hasValue || hasOther) push(`"${condition.op}" takes no operand — remove \`value\`/\`other_field\``, ruleId);
    return;
  }
  if (hasValue === hasOther) {
    push(`"${condition.op}" needs exactly one of \`value\` or \`other_field\``, ruleId);
    return;
  }

  let other = null;
  if (hasOther) {
    other = byName.get(condition.other_field);
    if (!other) {
      push(`\`${slot}\` references unknown field "${condition.other_field}"`, ruleId);
      return;
    }
  }

  const subjectKind = TYPE_KINDS[subject.type];

  if (ORDER_OPS.has(condition.op)) {
    if (subjectKind !== "number" && subjectKind !== "string") {
      push(`"${condition.op}" cannot order a ${subject.type} field ("${condition.field}")`, ruleId);
    } else if (other && TYPE_KINDS[other.type] !== subjectKind) {
      push(
        `"${condition.op}" cannot compare ${subject.type} "${condition.field}" with ${other.type} "${condition.other_field}"`,
        ruleId,
      );
    } else if (hasValue && describeType(condition.value) !== subjectKind) {
      push(
        `"${condition.op}" cannot compare ${subject.type} "${condition.field}" with ${describeType(condition.value)}`,
        ruleId,
      );
    }
  }

  if (condition.op === "contains" || condition.op === "not_contains") {
    if (subjectKind !== "list") {
      push(`"${condition.op}" needs a multi_choice field, but "${condition.field}" is ${subject.type}`, ruleId);
    }
  }

  if (condition.op === "in" || condition.op === "not_in") {
    if (hasValue && !Array.isArray(condition.value)) push(`"${condition.op}" needs \`value\` to be a list`, ruleId);
    if (other && TYPE_KINDS[other.type] !== "list") {
      push(`"${condition.op}" needs \`other_field\` to be a multi_choice field`, ruleId);
    }
  }
}

module.exports = { validateRecord, validateDefinition, TYPE_VALIDATORS };
