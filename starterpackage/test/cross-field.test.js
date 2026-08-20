"use strict";

/**
 * Cross-field rule tests.
 *
 * The existing per-field suite in validate.test.js is untouched and still passes.
 * Everything here is new behavior: the `rules` block, the skip semantics for
 * missing and invalid dependencies, and the definition checker.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateRecord, validateDefinition } = require("../lib/validate");

function loadClient(filename) {
  const p = path.join(__dirname, "..", "clients", filename);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const clientA = loadClient("client-a-city-maintenance.json");
const clientB = loadClient("client-b-grant-foundation.json");
const clientC = loadClient("client-c-clinic.json");

/** A valid client B application, so each test only has to state what it changes. */
function grantApplication(overrides) {
  return Object.assign(
    {
      organisation_name: "River Basin Trust",
      registry_number: "RN-004821",
      contact_person: "Dana Cole",
      requested_amount: 25000,
      priority_areas: ["environment", "education"],
      project_description: "Riverbank restoration and youth education program.",
      project_start_date: "2027-01-15",
      project_end_date: "2027-12-15",
      budget_file: { filename: "budget.pdf" },
    },
    overrides,
  );
}

const errorsFor = (result, field) => result.errors.filter((e) => e.field === field);

// ---- The worked example: end date must not precede start date -------------

test("end date before start date is rejected, against the end date", () => {
  const result = validateRecord(clientB, grantApplication({ project_end_date: "2026-12-15" }));

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1, JSON.stringify(result.errors));

  const [error] = result.errors;
  assert.equal(error.field, "project_end_date");
  assert.equal(error.rule, "end_date_not_before_start_date");
  assert.equal(error.message, "Project end date must not be before the project start date");

  // The start date is innocent — the rule blames the field the user must change.
  assert.equal(errorsFor(result, "project_start_date").length, 0);
});

test("end date equal to start date passes — gte is inclusive", () => {
  const record = grantApplication({ project_start_date: "2027-05-01", project_end_date: "2027-05-01" });
  const result = validateRecord(clientB, record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("end date after start date passes", () => {
  const result = validateRecord(clientB, grantApplication());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("date comparison is calendar-correct across a year boundary", () => {
  const record = grantApplication({ project_start_date: "2027-12-31", project_end_date: "2028-01-01" });
  assert.equal(validateRecord(clientB, record).valid, true);
});

// ---- Awkward case 1: a dependency that was not submitted -------------------

test("a rule whose dependency is missing and required reports only the missing field", () => {
  const record = grantApplication({ project_end_date: "2020-01-01" });
  delete record.project_start_date;

  const result = validateRecord(clientB, record);

  assert.equal(result.valid, false);
  assert.equal(errorsFor(result, "project_start_date").length, 1, "the required-field error still fires");
  assert.equal(
    errorsFor(result, "project_end_date").length,
    0,
    "no derived error about a comparison that could not be made",
  );
});

test("a rule whose dependency is missing and optional does not fire at all", () => {
  // Same rule, but on a definition where both dates are optional. Leaving an
  // optional field blank must not become an error by way of a cross-field rule.
  const definition = {
    fields: [
      { name: "starts_on", label: "Starts on", type: "date", required: false },
      { name: "ends_on", label: "Ends on", type: "date", required: false },
    ],
    rules: [
      {
        id: "ends_after_starts",
        assert: { field: "ends_on", op: "gte", other_field: "starts_on" },
        error: { message: "Ends on must not be before Starts on" },
      },
    ],
  };

  assert.equal(validateRecord(definition, { ends_on: "2027-01-01" }).valid, true);
  assert.equal(validateRecord(definition, { starts_on: "2027-01-01" }).valid, true);
  assert.equal(validateRecord(definition, {}).valid, true);
  assert.equal(validateRecord(definition, { starts_on: "2027-06-01", ends_on: "2027-01-01" }).valid, false);
});

// ---- Awkward case 2: a dependency that failed its own validation -----------

test("a rule whose dependency is malformed does not add a second, derived error", () => {
  const record = grantApplication({ project_start_date: "15/01/2027", project_end_date: "2027-12-15" });
  const result = validateRecord(clientB, record);

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
  assert.equal(result.errors[0].field, "project_start_date");
  assert.equal(result.errors[0].rule, undefined, "per-field errors carry no rule id");
});

test("a rule whose own subject is malformed does not fire either", () => {
  const record = grantApplication({ project_end_date: "not-a-date" });
  const result = validateRecord(clientB, record);

  assert.equal(errorsFor(result, "project_end_date").length, 1);
  assert.equal(result.errors[0].rule, undefined, "the format error, not the rule");
});

// ---- `when`: conditional requirement ---------------------------------------

const conditionalRequirement = {
  fields: [
    { name: "issue_type", label: "Issue type", type: "choice", required: true, options: ["pothole", "other"] },
    { name: "other_description", label: "Other description", type: "text", required: false },
  ],
  rules: [
    {
      id: "describe_other_issue",
      when: { field: "issue_type", op: "eq", value: "other" },
      assert: { field: "other_description", op: "present" },
      error: { message: "Please describe the issue when the issue type is Other" },
    },
  ],
};

test("a required-if rule fires when its guard matches", () => {
  const result = validateRecord(conditionalRequirement, { issue_type: "other" });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, "other_description", "error defaults to the assert subject");
  assert.equal(result.errors[0].rule, "describe_other_issue");
});

test("a required-if rule stays quiet when its guard does not match", () => {
  assert.equal(validateRecord(conditionalRequirement, { issue_type: "pothole" }).valid, true);
});

test("a required-if rule is satisfied once the dependent field is filled in", () => {
  const record = { issue_type: "other", other_description: "Collapsed kerbstone" };
  assert.equal(validateRecord(conditionalRequirement, record).valid, true);
});

test("a guard whose own field is missing reports only that field, not the rule", () => {
  const result = validateRecord(conditionalRequirement, {});
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].field, "issue_type");
});

test("`absent` is expressible too — a field that must be left blank", () => {
  const definition = {
    fields: [
      { name: "status", label: "Status", type: "choice", required: true, options: ["open", "closed"] },
      { name: "closed_on", label: "Closed on", type: "date", required: false },
    ],
    rules: [
      {
        id: "no_closed_date_while_open",
        when: { field: "status", op: "eq", value: "open" },
        assert: { field: "closed_on", op: "absent" },
        error: { message: "Closed on must be empty while the record is open" },
      },
    ],
  };

  assert.equal(validateRecord(definition, { status: "open" }).valid, true);
  assert.equal(validateRecord(definition, { status: "closed", closed_on: "2027-01-01" }).valid, true);

  const result = validateRecord(definition, { status: "open", closed_on: "2027-01-01" });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, "closed_on");
});

// ---- Combinators and the remaining operators -------------------------------

test("any_of expresses `at least one of these fields`", () => {
  const definition = {
    fields: [
      { name: "phone", label: "Phone", type: "text", required: false },
      { name: "email", label: "Email", type: "text", required: false },
    ],
    rules: [
      {
        id: "one_contact_method",
        assert: {
          any_of: [
            { field: "phone", op: "present" },
            { field: "email", op: "present" },
          ],
        },
        error: { field: "phone", message: "Give either a phone number or an email address" },
      },
    ],
  };

  assert.equal(validateRecord(definition, { phone: "+44 20 7946 0000" }).valid, true);
  assert.equal(validateRecord(definition, { email: "a@example.org" }).valid, true);

  const result = validateRecord(definition, {});
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, "phone", "a combinator has no subject, so error.field is mandatory");
});

test("all_of narrows a guard to a combination of values", () => {
  const definition = {
    fields: [
      { name: "amount", label: "Amount", type: "number", required: true },
      { name: "ceiling", label: "Ceiling", type: "number", required: true },
      { name: "expedited", label: "Expedited", type: "boolean", required: true },
      { name: "justification", label: "Justification", type: "long_text", required: false },
    ],
    rules: [
      {
        id: "justify_large_expedited_request",
        when: {
          all_of: [
            { field: "expedited", op: "eq", value: true },
            { field: "amount", op: "gt", other_field: "ceiling" },
          ],
        },
        assert: { field: "justification", op: "present" },
        error: { message: "Justify an expedited request above the ceiling" },
      },
    ],
  };

  assert.equal(validateRecord(definition, { amount: 10, ceiling: 100, expedited: true }).valid, true);
  assert.equal(validateRecord(definition, { amount: 500, ceiling: 100, expedited: false }).valid, true);

  const result = validateRecord(definition, { amount: 500, ceiling: 100, expedited: true });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, "justification");
});

test("contains reads a multi_choice field", () => {
  const definition = {
    fields: [
      {
        name: "priority_areas",
        label: "Priority areas",
        type: "multi_choice",
        required: true,
        options: ["health", "housing"],
      },
      { name: "clinical_lead", label: "Clinical lead", type: "text", required: false },
    ],
    rules: [
      {
        id: "health_needs_a_clinical_lead",
        when: { field: "priority_areas", op: "contains", value: "health" },
        assert: { field: "clinical_lead", op: "present" },
        error: { message: "Name a clinical lead when health is a priority area" },
      },
    ],
  };

  assert.equal(validateRecord(definition, { priority_areas: ["housing"] }).valid, true);
  assert.equal(validateRecord(definition, { priority_areas: ["health"], clinical_lead: "Dr Adeyemi" }).valid, true);
  assert.equal(validateRecord(definition, { priority_areas: ["housing", "health"] }).valid, false);
});

test("error.field can point somewhere other than the assert subject", () => {
  const definition = {
    fields: [
      { name: "minimum", label: "Minimum", type: "number", required: true },
      { name: "maximum", label: "Maximum", type: "number", required: true },
    ],
    rules: [
      {
        id: "range_is_ordered",
        assert: { field: "maximum", op: "gte", other_field: "minimum" },
        error: { field: "minimum", message: "Minimum must not exceed Maximum" },
      },
    ],
  };

  const result = validateRecord(definition, { minimum: 10, maximum: 5 });
  assert.equal(result.errors[0].field, "minimum");
});

// ---- Properties of the whole phase -----------------------------------------

test("rules are order-independent", () => {
  const ruleA = {
    id: "a",
    assert: { field: "high", op: "gte", other_field: "low" },
    error: { message: "high must be at least low" },
  };
  const ruleB = {
    id: "b",
    assert: { field: "low", op: "gte", value: 0 },
    error: { message: "low must not be negative" },
  };
  const fields = [
    { name: "low", label: "Low", type: "number", required: true },
    { name: "high", label: "High", type: "number", required: true },
  ];
  const record = { low: -5, high: -10 };

  const forwards = validateRecord({ fields, rules: [ruleA, ruleB] }, record);
  const backwards = validateRecord({ fields, rules: [ruleB, ruleA] }, record);

  const ids = (result) => result.errors.map((e) => e.rule).sort();
  assert.deepEqual(ids(forwards), ["a", "b"]);
  assert.deepEqual(ids(forwards), ids(backwards));
});

test("every failing rule reports — the phase does not stop at the first", () => {
  const definition = {
    fields: [
      { name: "a", label: "A", type: "number", required: true },
      { name: "b", label: "B", type: "number", required: true },
    ],
    rules: [
      { id: "one", assert: { field: "a", op: "gt", other_field: "b" }, error: { message: "a must exceed b" } },
      { id: "two", assert: { field: "a", op: "neq", value: 1 }, error: { message: "a must not be 1" } },
    ],
  };
  const result = validateRecord(definition, { a: 1, b: 2 });
  assert.equal(result.errors.length, 2);
});

test("a definition with no rules behaves exactly as before", () => {
  const result = validateRecord(clientA, {
    resident_name: "Maria Santos",
    resident_phone: "+63 917 555 0101",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "pothole",
    description: "Large pothole blocking half the lane.",
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("an unknown operator is reported loudly, not treated as a pass", () => {
  const definition = {
    fields: [
      { name: "a", label: "A", type: "number", required: true },
      { name: "b", label: "B", type: "number", required: true },
    ],
    rules: [
      {
        id: "bad_op",
        assert: { field: "a", op: "approximately", other_field: "b" },
        error: { message: "never reached" },
      },
    ],
  };

  const result = validateRecord(definition, { a: 1, b: 2 });
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /could not be evaluated/);
  assert.equal(result.errors[0].rule, "bad_op");
});

test("a rule with nowhere to report is reported loudly, not skipped", () => {
  const definition = {
    fields: [{ name: "a", label: "A", type: "number", required: true }],
    rules: [
      {
        id: "no_target",
        assert: { any_of: [{ field: "a", op: "present" }] },
        error: { message: "no field named" },
      },
    ],
  };

  const result = validateRecord(definition, { a: 1 });
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /malformed/);
});

// ---- validateDefinition -----------------------------------------------------

test("the shipped client definitions are all coherent", () => {
  for (const definition of [clientA, clientB, clientC]) {
    const result = validateDefinition(definition);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }
});

test("a rule referencing a field that does not exist is caught before use", () => {
  const result = validateDefinition({
    fields: [{ name: "ends_on", label: "Ends on", type: "date", required: true }],
    rules: [
      {
        id: "typo",
        assert: { field: "ends_on", op: "gte", other_field: "start_on" }, // starts_on, mistyped
        error: { message: "Ends on must not be before Starts on" },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /unknown field "start_on"/);
  assert.equal(result.errors[0].rule, "typo");
});

test("ordering two fields of incompatible types is caught before use", () => {
  const result = validateDefinition({
    fields: [
      { name: "ends_on", label: "Ends on", type: "date", required: true },
      { name: "budget", label: "Budget", type: "number", required: true },
    ],
    rules: [
      {
        id: "nonsense",
        assert: { field: "ends_on", op: "gte", other_field: "budget" },
        error: { message: "never sensible" },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /cannot compare date .* with number/);
});

test("a combinator assert without an explicit error.field is caught before use", () => {
  const result = validateDefinition({
    fields: [
      { name: "phone", label: "Phone", type: "text", required: false },
      { name: "email", label: "Email", type: "text", required: false },
    ],
    rules: [
      {
        id: "one_contact_method",
        assert: {
          any_of: [
            { field: "phone", op: "present" },
            { field: "email", op: "present" },
          ],
        },
        error: { message: "Give either a phone number or an email address" },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /explicit `error.field`/);
});

test("giving both value and other_field is caught before use", () => {
  const result = validateDefinition({
    fields: [
      { name: "a", label: "A", type: "number", required: true },
      { name: "b", label: "B", type: "number", required: true },
    ],
    rules: [
      {
        id: "ambiguous",
        assert: { field: "a", op: "gte", value: 5, other_field: "b" },
        error: { message: "which one?" },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /exactly one of/);
});

test("giving an operand to a presence operator is caught before use", () => {
  const result = validateDefinition({
    fields: [{ name: "a", label: "A", type: "text", required: false }],
    rules: [
      {
        id: "over_specified",
        assert: { field: "a", op: "present", value: true },
        error: { message: "A is required" },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /takes no operand/);
});

test("contains on a field that is not a list is caught before use", () => {
  const result = validateDefinition({
    fields: [
      { name: "notes", label: "Notes", type: "long_text", required: false },
      { name: "lead", label: "Lead", type: "text", required: false },
    ],
    rules: [
      {
        id: "wrong_shape",
        when: { field: "notes", op: "contains", value: "urgent" },
        assert: { field: "lead", op: "present" },
        error: { message: "Name a lead" },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /needs a multi_choice field/);
});

test("a duplicate rule id is caught before use", () => {
  const rule = {
    id: "same",
    assert: { field: "a", op: "present" },
    error: { message: "A is required" },
  };
  const result = validateDefinition({
    fields: [{ name: "a", label: "A", type: "text", required: false }],
    rules: [rule, rule],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /Duplicate rule id/);
});

test("a rule with no error message is caught before use", () => {
  const result = validateDefinition({
    fields: [{ name: "a", label: "A", type: "text", required: false }],
    rules: [{ id: "silent", assert: { field: "a", op: "present" } }],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /error\.message/);
});
