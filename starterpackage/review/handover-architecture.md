# Platform Foundation — Handover Notes

**From:** the contractor who built the first version
**To:** whoever picks this up next
**Status:** three clients live on this (City maintenance, Grant-making foundation, Private clinic). A fourth is signing soon.

I built this over a few months working solo, so some of it is more "get it working" than "get it perfect." I've tried to flag the rough edges honestly rather than let you find them the hard way. Read this together with the code — it should match, but I wrote this from memory on my last day so double-check anything that looks off.

Stack: Node.js/Express API, PostgreSQL, a message broker for background work. Nothing exotic.

---

## 1. Multi-tenancy & data isolation

Every client's data lives in the same database, same tables, distinguished by a `tenant_id` column. This is the "pool" model — one schema, shared by everyone, which is what makes it cheap to bring a new client on. All three current clients are in the pool; nothing is siloed.

Isolation is enforced with Postgres Row-Level Security. Every tenant table has a policy like this:

```sql
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON reports
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

The `USING` clause means a query only ever sees rows belonging to the tenant currently set in the session — so even if a route handler forgets to filter by tenant explicitly, the database backstops it. This is on every tenant-owned table: `reports`, `applications`, `referrals`, `contacts`, `custom_fields`, all of it.

### Setting the tenant context

Each request resolves the caller's tenant (from their session/API key) and sets it at the top of the request, before any query runs:

```js
async function setTenantContext(client, tenantId) {
  await client.query(`SET app.current_tenant = '${tenantId}'`);
}
```

This runs once per request, right after auth, using the connection checked out for that request. Everything the request does afterward is scoped correctly by the RLS policy above.

### The audit log

Every write goes through a `logAction()` helper that inserts into `audit_log`:

```sql
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);
```

I kept this one simpler than the tenant tables — it's an operational/administrative log rather than tenant-facing data, and having everything in one place made it a lot easier to debug across clients while I was the only one building this. `entity_id` plus `entity_type` is enough to trace any record back to what happened to it.

### Database roles

Two Postgres roles: `app_user` for the API (no special privileges, RLS always applies to it) and `app_admin` for migrations and one-off maintenance scripts, which bypasses RLS. `app_admin` isn't used in request-serving code — only for schema changes and the odd manual data fix.

---

## 2. Request flow

Every API request goes: parse → authenticate → set tenant context (Section 1) → authorize (role check) → route handler. The web UI is a client of the same API, no separate backend — this keeps the surface area small enough that one person could build it.

Auth is a standard JWT-based session, verified by a well-known library rather than anything homegrown. Nothing unusual here.

---

## 3. Configuration & custom fields

Each client can add custom fields to their objects (a Report, an Application, a Referral) without a migration — there's a `custom_fields jsonb` column on each core table, plus a small `field_definitions` table describing each tenant's custom fields (name, type, required, options). The API reads the field definitions and validates/serializes accordingly. Nothing fancy, but it's covered the "add one more field" requests fine so far.

---

## 4. Creating a record

The create path for all three clients follows the same shape (Reports for Client A, Applications for Client B, Referrals for Client C). Using Client A as the example:

```js
async function createReport(req, res) {
  const record = await db.query(
    `INSERT INTO reports (tenant_id, resident_name, resident_phone, street_address,
       district, issue_type, description, photo_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new')
     RETURNING *`,
    [req.tenantId, body.resident_name, body.resident_phone, body.street_address,
     body.district, body.issue_type, body.description, body.photo_url]
  );

  // let the resident know we've got it
  await sendConfirmationSms(record.resident_phone, record.id);

  return res.status(201).json(record);
}
```

Straightforward insert-then-notify. The SMS/email send for the relevant client (SMS for Client A, email for Client B/C) happens right after the insert, before the response goes back, so by the time the caller gets a 201 they know the notification has actually gone out — no separate step that could silently fail without anyone noticing.

---

## 5. Listing records

Every client needs a paginated list view (the call-centre queue, the applications table, the referral list). One shared handler, parameterized by table:

```js
async function listRecords(req, res) {
  const { offset = 0, limit = 50 } = req.query;
  const rows = await db.query(
    `SELECT * FROM ${table} ORDER BY created_at DESC OFFSET $1 LIMIT $2`,
    [offset, limit]
  );
  return res.json(rows);
}
```

Standard offset/limit pagination — the frontend just increments the page number. `created_at` has a plain index on it, so recent-first ordering is fast. This has held up fine through the storm-day spike on Client A (4,000 reports in an afternoon) — the query itself is cheap, it's the write volume that mattered there, not the read side.

---

## 6. Background work

Anything that shouldn't block the request — sending the fourteen-day follow-up email on Client B, alerting the duty nurse on an untriaged urgent referral for Client C, re-indexing search — goes through a queue rather than running inline.

The write and the enqueue happen in the same database transaction:

```js
await client.query('BEGIN');
await client.query(
  `UPDATE applications SET status = $1 WHERE id = $2`, [status, id]
);
await client.query(
  `INSERT INTO outbox (event_type, tenant_id, payload) VALUES ($1, $2, $3)`,
  ['application.status_changed', tenantId, JSON.stringify({ id, status })]
);
await client.query('COMMIT');
```

A separate relay process polls the `outbox` table for unpublished rows, pushes them to the broker, and marks them dispatched only once the broker confirms receipt — so a crash between the DB commit and the publish just means the relay picks it up on the next poll, nothing is lost. Handlers on the other end key off an `(event_type, entity_id)` pair to skip anything they've already processed, and retries are capped (five attempts, backing off, then it lands in a dead-letter table for a human to look at) so a permanently failing handler doesn't spin forever. This part I'm fairly happy with — it's been solid since I put it in.

---

## 7. Data model, briefly

- `reports` (Client A), `applications` (Client B), `referrals` (Client C) — the core object per client, each with its own status enum and its own `custom_fields jsonb`.
- `contacts` — shared contact records (the resident, the applicant org's contact person, the referring physician).
- `field_definitions` — per-tenant custom field metadata (Section 3).
- `outbox` — the event queue (Section 6).
- `audit_log` — the action log (Section 1).

Nothing here is exotic; it's a fairly conventional relational layout. The `custom_fields` JSONB column is the only real deviation from "just add columns," and that was purely to avoid a migration every time a client wants one more field.

---

## 8. What I didn't get to

Being straight about the gaps rather than leaving you to discover them:

- **Rate limiting isn't built.** Right now nothing stops one client's traffic spike from slowing things down for everyone else on the same database. Hasn't bitten us yet with three clients, but it's a real gap as more come on.
- **Entitlements/feature flags aren't built either.** Every tenant currently gets every feature — there's no per-client on/off switch for modules. With three clients I know personally, that's been fine to leave for later; it's more of a nice-to-have for when the product side wants to sell different tiers than something urgent.
- **No dedicated search** — list views use the plain SQL queries in Section 5. Fine at current volume; would need a real index (or a search service) if a client wanted free-text search over thousands of records.
- **Silo/dedicated-database isolation isn't implemented** — everything's in the shared pool today (Section 1). If a client ever needs their data physically separate, that's new work, not a flag to flip.

Good luck with it — happy to answer questions for a couple of weeks if anything doesn't add up, after that I'm off this client's Slack.
