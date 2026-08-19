"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateRecord } = require("../lib/validate");

function loadClient(filename) {
  const p = path.join(__dirname, "..", "clients", filename);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const clientA = loadClient("client-a-city-maintenance.json");
const clientB = loadClient("client-b-grant-foundation.json");
const clientC = loadClient("client-c-clinic.json");

// ---- Client A: infrastructure report ----------------------------------

test("client A: a fully valid record passes", () => {
  const record = {
    resident_name: "Maria Santos",
    resident_phone: "+63 917 555 0101",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "pothole",
    description: "Large pothole blocking half the lane.",
  };
  const result = validateRecord(clientA, record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("client A: missing a required field fails", () => {
  const record = {
    resident_phone: "+63 917 555 0101",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "pothole",
    description: "Large pothole blocking half the lane.",
  };
  const result = validateRecord(clientA, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "resident_name"));
});

test("client A: phone that doesn't match the pattern fails", () => {
  const record = {
    resident_name: "Maria Santos",
    resident_phone: "not-a-phone!!",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "pothole",
    description: "Large pothole blocking half the lane.",
  };
  const result = validateRecord(clientA, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "resident_phone"));
});

test("client A: issue_type outside the option list fails", () => {
  const record = {
    resident_name: "Maria Santos",
    resident_phone: "+63 917 555 0101",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "graffiti", // not in the allowed options
    description: "Not one of ours.",
  };
  const result = validateRecord(clientA, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "issue_type"));
});

test("client A: an optional field left out is fine", () => {
  const record = {
    resident_name: "Maria Santos",
    resident_phone: "+63 917 555 0101",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "pothole",
    description: "Large pothole blocking half the lane.",
    // photo omitted — optional
  };
  const result = validateRecord(clientA, record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("client A: photo with a disallowed extension fails", () => {
  const record = {
    resident_name: "Maria Santos",
    resident_phone: "+63 917 555 0101",
    street_address: "12 Rizal St",
    district: "north",
    issue_type: "pothole",
    description: "Large pothole blocking half the lane.",
    photo: { filename: "evidence.gif" },
  };
  const result = validateRecord(clientA, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "photo"));
});

// ---- Client B: grant application ---------------------------------------

test("client B: a fully valid record passes", () => {
  const record = {
    organisation_name: "River Basin Trust",
    registry_number: "RN-004821",
    contact_person: "Dana Cole",
    requested_amount: 25000,
    priority_areas: ["environment", "education"],
    project_description: "Riverbank restoration and youth education program.",
    project_start_date: "2027-01-15",
    project_end_date: "2027-12-15",
    budget_file: { filename: "budget.pdf" },
  };
  const result = validateRecord(clientB, record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("client B: negative requested_amount fails", () => {
  const record = {
    organisation_name: "River Basin Trust",
    registry_number: "RN-004821",
    contact_person: "Dana Cole",
    requested_amount: -500,
    priority_areas: ["environment"],
    project_description: "Riverbank restoration.",
    project_start_date: "2027-01-15",
    project_end_date: "2027-12-15",
    budget_file: { filename: "budget.pdf" },
  };
  const result = validateRecord(clientB, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "requested_amount"));
});

test("client B: priority_areas with too many selections fails", () => {
  const record = {
    organisation_name: "River Basin Trust",
    registry_number: "RN-004821",
    contact_person: "Dana Cole",
    requested_amount: 25000,
    priority_areas: ["environment", "education", "health", "housing"], // max_selected is 3
    project_description: "Riverbank restoration.",
    project_start_date: "2027-01-15",
    project_end_date: "2027-12-15",
    budget_file: { filename: "budget.pdf" },
  };
  const result = validateRecord(clientB, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "priority_areas"));
});

test("client B: priority_areas with an unknown option fails", () => {
  const record = {
    organisation_name: "River Basin Trust",
    registry_number: "RN-004821",
    contact_person: "Dana Cole",
    requested_amount: 25000,
    priority_areas: ["environment", "space_travel"],
    project_description: "Riverbank restoration.",
    project_start_date: "2027-01-15",
    project_end_date: "2027-12-15",
    budget_file: { filename: "budget.pdf" },
  };
  const result = validateRecord(clientB, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "priority_areas"));
});

test("client B: malformed date fails", () => {
  const record = {
    organisation_name: "River Basin Trust",
    registry_number: "RN-004821",
    contact_person: "Dana Cole",
    requested_amount: 25000,
    priority_areas: ["environment"],
    project_description: "Riverbank restoration.",
    project_start_date: "15/01/2027", // wrong format
    project_end_date: "2027-12-15",
    budget_file: { filename: "budget.pdf" },
  };
  const result = validateRecord(clientB, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "project_start_date"));
});

// ---- Client C: patient referral -----------------------------------------

test("client C: a fully valid record passes", () => {
  const record = {
    patient_name: "J. Almeida",
    national_id: "123456789",
    date_of_birth: "1990-04-02",
    phone: "+972 50 555 1234",
    referring_physician: "Dr. Rivka Cohen",
    physician_licence_number: "LIC-00921",
    service_line: "cardiology",
    priority_level: "routine",
  };
  const result = validateRecord(clientC, record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("client C: national_id that isn't 9 digits fails", () => {
  const record = {
    patient_name: "J. Almeida",
    national_id: "12345",
    date_of_birth: "1990-04-02",
    phone: "+972 50 555 1234",
    referring_physician: "Dr. Rivka Cohen",
    physician_licence_number: "LIC-00921",
    service_line: "cardiology",
    priority_level: "routine",
  };
  const result = validateRecord(clientC, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "national_id"));
});

test("client C: priority_level outside the option list fails", () => {
  const record = {
    patient_name: "J. Almeida",
    national_id: "123456789",
    date_of_birth: "1990-04-02",
    phone: "+972 50 555 1234",
    referring_physician: "Dr. Rivka Cohen",
    physician_licence_number: "LIC-00921",
    service_line: "cardiology",
    priority_level: "asap", // not a valid option
  };
  const result = validateRecord(clientC, record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "priority_level"));
});

test("client C: optional clinical_notes left out is fine", () => {
  const record = {
    patient_name: "J. Almeida",
    national_id: "123456789",
    date_of_birth: "1990-04-02",
    phone: "+972 50 555 1234",
    referring_physician: "Dr. Rivka Cohen",
    physician_licence_number: "LIC-00921",
    service_line: "cardiology",
    priority_level: "urgent",
  };
  const result = validateRecord(clientC, record);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

// ---- Generic / cross-client behavior ------------------------------------

test("an unknown field type produces an error rather than a crash", () => {
  const definition = {
    fields: [{ name: "mystery", label: "Mystery field", type: "holoscan", required: true }],
  };
  const result = validateRecord(definition, { mystery: "anything" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === "mystery"));
});
