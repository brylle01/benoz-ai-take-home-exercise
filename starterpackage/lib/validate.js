"use strict";

/**
 * Field-definition-driven record validator.
 *
 * A "definition" is: { fields: [ { name, label, type, required, options?, constraints? }, ... ] }
 * A "record" is a plain object of { fieldName: value }.
 *
 * validateRecord(definition, record) -> { valid: boolean, errors: [{ field, message }] }
 *
 * This module is deliberately client-agnostic: it knows nothing about any
 * particular client's field names or business rules. It only knows the
 * generic type/constraint vocabulary below.
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
 * Validate a record against a field definition list.
 * Per-field validation only — no cross-field rules. See the README for the
 * extension task that adds those.
 */
function validateRecord(definition, record) {
  const errors = [];
  const fields = (definition && definition.fields) || [];

  for (const field of fields) {
    const value = record ? record[field.name] : undefined;
    const present = isPresent(value);

    if (!present) {
      if (field.required) {
        errors.push({ field: field.name, message: `${fieldLabel(field)} is required` });
      }
      continue; // optional and absent: nothing further to check
    }

    const validator = TYPE_VALIDATORS[field.type];
    if (!validator) {
      errors.push({ field: field.name, message: `Unknown field type "${field.type}" for ${fieldLabel(field)}` });
      continue;
    }

    validator(field, value, errors);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateRecord, TYPE_VALIDATORS };
