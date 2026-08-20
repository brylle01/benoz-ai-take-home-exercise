# Part 1 — Review of the handover

I read `review/handover-architecture.md` as the person who has to run this. The document is honest and unusually well written for a handover — the gaps in Section 8 are real gaps, admitted plainly, and the outbox in Section 6 is genuinely good work. Most of what follows is not in Section 8.

One caveat the author invited: the code snippets were written from memory on their last day, and several of them cannot run as printed (`db.query(...)` returns a pg `Result`, so `record.resident_phone` in Section 4 is `undefined`; `body` is never destructured from `req`). So I have separated "this is wrong" from "this reads as wrong and I would check the code first." I have said which is which.

---

## Critical

### 1. The tenant context is session-scoped, on a pooled connection

**The problem.** `SET app.current_tenant = '...'` is a *session*-level setting. It survives `COMMIT`, and it survives the request. When the connection goes back to the pool, it still carries the last tenant's UUID.

Everything about isolation depends on the next request overwriting it on the *same* connection before it queries. The snippets say that doesn't reliably happen: `setTenantContext` takes an explicit `client`, but `createReport` and `listRecords` both call `db.query(...)` — a pool handle, which checks out an arbitrary connection per call. If those are genuinely different connections, then:

- the connection serving the query has some *other* tenant's ID still set, and `listRecords`, which has no `WHERE tenant_id` of its own, returns that tenant's rows. Client A's call-centre operator opens the queue and sees Client C's referrals. No error, no log line, correct-looking data.
- or the connection was never set at all, in which case `current_setting('app.current_tenant', true)` is NULL, `tenant_id = NULL` is NULL, and the query returns zero rows. Loud and safe, but broken.

Which one you get depends on pool scheduling, so it is intermittent, and it gets *more* likely as concurrency rises — i.e. as they add clients. Section 1 explicitly uses this mechanism to justify not filtering by tenant in handlers ("even if a route handler forgets to filter by tenant explicitly, the database backstops it"), which is why `listRecords` has no tenant predicate. The backstop is the only thing standing there.

Two secondary problems in the same four lines:

- The tenant ID is string-interpolated into the statement. Today it probably comes from a verified session, so it is probably a trusted UUID. If tenant resolution ever moves to a subdomain or a header — which it will, "same-day setup for new clients" pushes exactly that way — this becomes injection into a statement that can also `SET ROLE`, and the whole RLS layer is bypassable. `SET` can't take a bind parameter, which is likely why it was written this way.
- Nothing resets the setting on release, so a connection that errors out mid-request goes back to the pool still armed.

**Severity: critical** — cross-tenant data leak.

**What I'd do.** Replace it with a transaction-local setting, bound as a parameter:

```js
// inside the transaction that the request will actually use
await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant', tenantId]);
```

`set_config(..., true)` is the function form of `SET LOCAL` — it unwinds at the end of the transaction, so a connection can never be handed on while still armed, and the third argument being `true` is the whole fix for the leak. Then make it structurally impossible to get wrong: check out one client per request, run the entire request inside one transaction, and pass that client to handlers. If `db` stays reachable as a pool handle inside a route, someone will use it. Add `DISCARD ALL` on release as belt-and-braces, and add a test that runs two requests for different tenants across a pool of size 1 and asserts the second sees nothing of the first — that test is the one that would have caught this.

### 2. `audit_log` has no `tenant_id`, no RLS, and no immutability

**The problem.** The author is upfront that this table was deliberately kept outside the tenant scheme, for good reasons at the time (one person, three clients, cross-client debugging). Those reasons don't survive the third client, and the table holds `payload jsonb` of every write. For Client C that means national IDs and clinical notes, sitting in a table with no row-level security, no tenant column, and — because the payload is captured wholesale — no respect for the field-level rules that are supposed to keep clinical notes away from reception.

What goes wrong in practice, in rough order of when you'd hit it:

- Any internal admin or support screen that reads `audit_log` reads across every tenant at once. There is no policy that could stop it, because there is no column to write a policy against.
- The clinic expects to be audited. "Show me your audit trail for this patient" produces a query you cannot scope to the clinic, and the answer to "who else can read this table" is "anyone with app database access, for all three clients."
- Offboarding a client, or honouring an erasure request, is not expressible. You cannot delete a tenant's audit rows because you cannot identify them. `entity_id` + `entity_type` traces a record forward, but only if you already know which IDs belonged to whom — and once the core row is deleted, that mapping is gone.
- `actor_id uuid NOT NULL` has no room for a non-human actor. Client B auto-rejects applications below the threshold; the outbox relay writes; the 14-day follow-up fires with nobody logged in. Each of those either fails the insert or gets a fabricated UUID that someone will later have to explain to an auditor.
- Nothing makes the table append-only. If `app_user` can `INSERT`, it can almost certainly `UPDATE` and `DELETE`, which means the audit log is not evidence of anything.

**Severity: critical** — data leak and legal exposure, and it is the specific table a regulator will ask to see.

**What I'd do.** Add `tenant_id uuid NOT NULL` (nullable only for genuinely platform-level events, in a separate table), enable RLS on it with the same policy as everything else, and make `actor_id` nullable with an `actor_type` discriminator (`user` / `system` / `job`) so automated actions are recordable as automated. Revoke `UPDATE`/`DELETE` from `app_user` so the table is append-only at the grant level, not by convention. Backfilling `tenant_id` for existing rows is possible by joining `entity_id` back to the core tables while those rows still exist — that argues for doing it sooner rather than later. Separately, stop putting whole payloads in: log the field names that changed and their old/new values only for fields that aren't marked sensitive, and let the record itself be the source of truth for content.

### 3. There is no field-level authorization anywhere in the design

**The problem.** Section 2's request flow is parse → authenticate → set tenant → authorize → handler, and the authorize step is described as "role check" — a decision about whether you may call the route. Section 5 then does `SELECT *` and `res.json(rows)`. There is no layer in between that removes columns.

Client C's requirement is that reception sees the patient's name, phone and appointment but not the clinical notes. On this architecture, the moment reception is allowed to open the referral list at all, the JSON response contains `clinical_notes` and `national_id`. If the UI hides them, they are still on the wire and still in the browser's network tab. That is a live disclosure, today, not a future risk.

`SELECT *` also drags `custom_fields` out whole, so any sensitive field a client adds through the Section 3 mechanism is exposed by the same route with no further change — the leak grows on its own as clients configure more fields.

**Severity: critical** — data leak with named legal exposure (Israeli privacy law, and the clinic expects to be audited).

**What I'd do.** Two things, in order. Immediately: replace `SELECT *` with an explicit column list derived per role, and strip disallowed keys out of `custom_fields` before serialising. Properly: field-level permissions belong in the same configuration layer as `field_definitions` — each field definition gets a visibility class, and each role gets the set of classes it may read and the set it may write, so "reception cannot see clinical notes" and next month's equivalent for the fourth client are both config rather than a code change. That is a design project, not a patch; the patch buys you the time to do it. Postgres column-level `GRANT`s, or a security-barrier view per role, are worth considering as a second line of defence so that a future handler that forgets can't leak either.

### 4. File storage is not in the document at all

**The problem.** Client A uploads photos, Client B uploads a budget file, and the validator has a `file` type. The data model in Section 7 lists five tables and no object storage, and `photo_url` in Section 4 is just a text column. So the entire attachment path — where files live, who can read them, whether the URL is guessable, whether there is any tenant check on retrieval — is undescribed.

This matters more than a normal documentation gap, because RLS does not extend to an object store. Every isolation guarantee in Section 1 stops at the bucket. If those URLs are public-but-unguessable (the common shortcut, and `photo_url` being a bare string suggests it), then Client C's patient documents are protected by nothing but the length of a filename, and Decision 1's promise that the clinic's data stays on infrastructure they control is not true of their files.

**Severity: critical if the store is unauthenticated, serious if it isn't** — and the fact that I can't tell which from the document is itself the finding.

**What I'd do.** First establish what actually exists. Then: files served through the API, never directly from the bucket; a `files` table with `tenant_id` under the same RLS as everything else; short-lived signed URLs issued only after the same role and field checks that gate the parent record; and object keys namespaced by tenant so a misconfiguration fails obviously rather than silently. This also needs to be written down, because it is the part of the isolation story a regulator will ask about second.

---

## Serious

### 5. Notifications go out inline, in the create path

**The problem.** Section 4 inserts the record and then `await`s the SMS before responding, and defends this: "by the time the caller gets a 201 they know the notification has actually gone out — no separate step that could silently fail."

The defence doesn't hold. The insert is already committed when the SMS is attempted. If the provider is slow, the request hangs; if it errors, the caller gets a 500 for a report that was in fact created, and there is no retry — so the notification silently fails anyway, which is precisely the outcome the inline call was meant to prevent. Then the operator retries, and now there are two reports. On the storm afternoon — 4,000 reports, an SMS provider under the same regional load — this is the failure that produces a duplicated, half-notified queue on the day it matters most.

It's also inconsistent with the system's own best idea: Section 6 already has a transactional outbox that solves exactly this, and this path doesn't use it.

Separately, the brief says Client A's resident is texted on **Resolved**. This snippet texts them on **create**. That's either an undocumented extra message on every one of 200 daily reports (a real cost, and a plausible complaint source), or the doc drifted from the code. Worth confirming before touching anything.

**Severity: serious** — breaks under exactly the load spike they've already seen.

**What I'd do.** Write an outbox row in the same transaction as the insert and return 201 immediately. The relay sends it. The 201 then means "we have your report, durably," which is the honest promise and the one the resident cares about. Delivery status belongs on the notification record, visible in the UI, not encoded in the HTTP status of the create call.

### 6. The outbox dedup key drops repeat events

**The problem.** This is the one real bug in a section that is otherwise the best-designed part of the system. Handlers skip work they've already seen by keying off `(event_type, entity_id)`. That pair is not unique per event — it is unique per *record and kind of event*.

Client B's application emits `application.status_changed` at Submitted → Eligibility check, again at → Under review, again at → Committee, again at → Approved. The first one processed marks `('application.status_changed', <that application>)` as done. Every subsequent transition on that application is treated as a duplicate and dropped. The applicant never gets the decision email. Same shape for Client C: a referral that goes Received → Triaged → Scheduled will not send the physician's email at Scheduled, because the Triaged event already claimed the key.

This fails silently and it fails *late* — the first transition on every record works fine, which is what you'd check in testing.

**Severity: serious** — silently missing notifications on the transitions that matter most.

**What I'd do.** Give each outbox row an ID and dedupe on that; it is unique per event by construction, and at-least-once delivery from the relay is exactly what it's there to absorb. `(event_type, entity_id, occurred_at)` also works but is fragile if two transitions land in the same millisecond. This is a small change and I'd take it early — it is cheap, and it is currently wrong in production.

Two smaller notes on the same section. Nothing is described as watching the dead-letter table; for Client C the untriaged-urgent alert is the thing most likely to land there, and a patient-safety alert quietly parked in a table nobody reads is worse than no alert, because everyone believes the alert exists. Put a monitor on DLQ depth. And the relay is described as a single polling process — if it's genuinely single, it's a single point of failure for every notification on the platform; if you run two for availability, you need `FOR UPDATE SKIP LOCKED` so they don't both publish.

### 7. Nothing schedules time-based work

**The problem.** Section 6 lists Client B's fourteen-day follow-up and Client C's "urgent referral untriaged after four hours" as things that "go through a queue." A queue publishes events that have already happened. Neither of these is that.

The 14-day email needs delayed delivery — either broker support for it or a scheduled scanner. That's an omission.

The four-hour alert is worse, because it fires on the *absence* of an event. Nothing is written when a referral sits untriaged, so no outbox row is ever created, so there is nothing for the relay to pick up. As described, this alert cannot fire at all. It needs something that periodically asks "which urgent referrals are still untriaged and older than four hours," which is a scheduler and a query, not a queue.

**Severity: serious** — and patient-facing, which is why I'd rank it above the pagination items.

**What I'd do.** Add a scheduled job runner alongside the relay, with due-time rows in a table so a missed tick is caught up rather than skipped, and per-tenant configuration of the interval and target. Both of these requirements are "config, not code" candidates for the fourth client, so they should be expressed as data from the start. I'd also verify whether the 4-hour alert works today at all, because I don't believe it does.

### 8. Offset pagination gives the call centre wrong data, not just slow data

**The problem.** `OFFSET $1 LIMIT $2` over `ORDER BY created_at DESC` on a table that is being written to continuously. On the storm afternoon, an operator reads page 1, thirty reports arrive, then they click to page 2 — offset 50 now points 30 rows further back than it did, so they see rows they already saw and never see the 30 in between. Reports get worked twice and reports get missed. That's a correctness bug in the queue, not a performance complaint, and it is invisible in testing because it only appears under concurrent writes.

The performance issues are real too but secondary: `limit` comes straight from the query string with no cap, so `?limit=1000000` is a one-request denial of service against a database shared by every tenant, and Section 8 admits there is no rate limiting to stop it. And the index is on `created_at` alone — under RLS every query also filters `tenant_id`, so at 300 clients a small tenant's first page walks a mixed heap and discards other tenants' rows. It's fast today because with three tenants, most of what it scans is yours.

The document's claim that this "held up fine through the storm day" is probably true and slightly beside the point — 4,000 rows is small, and page 1 is cheap at any table size. The problems are at page 40, and at 300 tenants.

**Severity: serious.**

**What I'd do.** Keyset pagination on `(created_at, id)` — the client sends the last row it saw rather than a page number, which is stable under concurrent inserts and doesn't degrade with depth. Cap `limit` server-side. Add a composite index on `(tenant_id, created_at DESC)`. Also confirm that `${table}` is interpolated from a server-side allowlist and not from anything in the request; the phrase "parameterized by table" is doing a lot of work in that sentence, and if it reaches user input it is straightforward SQL injection.

### 9. "Configuration, not code" is only true of custom fields

**The problem.** This is the finding about the product rather than a bug, and I think it's the most consequential thing in the document.

The platform's premise is that client differences are configuration. Section 3 delivers that for one axis: adding a field. Every other axis the brief names as a constant request is still code:

- **Statuses.** Section 7: each core table has "its own status enum." A renamed status is a migration. A new status is a migration plus handler changes.
- **Transitions and who owns them.** "Only a department head may change status," "only a triage nurse may set priority," "different roles owning different stages" — none of this has a home in the data model. It lives in route handlers.
- **Roles.** "A new role that can do most of what an existing role does but not all of it" is the single most common request in the brief, and role checks are code. Each new role is a deploy.
- **Notifications.** Which event notifies whom, by which channel, with what wording — all code, per Section 4.
- **Separate tables per client.** `reports`, `applications`, `referrals` are three tables with the same shape and different column names. A fourth client needs a fourth table, a fourth enum, a fourth set of handlers.

The fourth client signs next month and nobody knows what they track. On this architecture, onboarding them is a schema migration and a release — which is the thing the platform exists to stop doing. Three custom systems have become one codebase with three code paths in it, which is genuinely better, but it is not yet a platform.

**Severity: serious**, and it compounds: every month spent adding clients this way adds another code path to migrate later.

**What I'd do.** Not a rewrite. The order I'd take it, cheapest and highest-leverage first: (1) move the status machine into configuration — states, allowed transitions, and the role permitted to make each one, as data per tenant, validated at the transition point; (2) move notification rules into configuration — trigger event, recipient, template, delay — which also gives the 14-day and 4-hour cases a home; (3) move role→permission mapping into data so a new role is a row; (4) only then consider collapsing the three core tables into one generic record table, which is the biggest change and the one I'd want the most evidence for. Steps 1–3 are what makes client four a configuration exercise. Step 4 is what makes client thirty a configuration exercise. I would not do step 4 before there is a client thirty.

---

## Minor

**10. RLS hardening.** `app_user` is stated to have no special privileges and `app_admin` owns migrations, which should mean RLS applies. It holds only as long as `app_user` never owns a table and is never granted `app_admin` — and a table created by the wrong role during a hurried migration silently loses its protection. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every tenant table costs nothing and removes the class of mistake. I'd also add a startup assertion that every table with a `tenant_id` column has RLS enabled and a policy, so a new table added without one fails loudly.

**11. JWT sessions.** "Standard, well-known library, nothing unusual" is credible and I'm not going to invent a problem. Two things I'd verify rather than assume: that the algorithm is pinned on verification (accepting whatever the token's header claims is the classic failure with well-known libraries), and that there is a revocation path. If the tenant and role are baked into a long-lived token, then removing someone's access, or demoting a role, doesn't take effect until it expires — which a clinic under audit will be asked about, and which also means a leaked token remains a valid key to a tenant.

**12. What the handover doesn't cover.** No backup or restore procedure, and no evidence a restore has been tested. No description of how a tenant is provisioned or offboarded — both of which are about to matter monthly. No environments or migration process. And the eligibility scoring engine for Client B — the most complex business logic on the platform, with an external API dependency and a formula the board rewrites annually — is not mentioned anywhere in the document. Either it isn't built, or it's built and undocumented, and I'd want to know which before I answered anything else about Client B.

---

## Things that look wrong and are actually right

The brief asks for these, and there are more than I expected. This is a better-built system than a fast skim suggests.

**The policy has `USING` but no `WITH CHECK`.** This looks like the classic RLS hole — reads are filtered, but nothing stops you inserting a row belonging to another tenant. It isn't. `CREATE POLICY` with no `FOR` clause defaults to `FOR ALL`, and Postgres uses the `USING` expression as the `WITH CHECK` expression when the latter is omitted. Inserts and updates are constrained to the current tenant too. Writing it explicitly would be clearer for the next reader, but the behaviour is correct as written.

**`current_setting('app.current_tenant', true)` — the `true` looks like a bypass.** It's the opposite. `missing_ok = true` makes the call return NULL instead of raising when the setting is absent; NULL then makes the comparison NULL, which is not true, so the policy matches zero rows. Without it, an unset context would throw an error, which is louder but no safer. The choice is right: an unset context fails closed. The danger in Section 1 is a *stale* value, not a missing one — which is finding 1, and a completely different bug from the one this line looks like. (One thing I'd actually test: whether a `RESET` or `DISCARD` leaves the setting as an empty string rather than absent on their Postgres version, since `''::uuid` raises rather than returning NULL. Cheap to check, and `SET LOCAL` makes it moot.)

**Writing `tenant_id` explicitly on insert when RLS already enforces it.** Reads as redundant. It's correct defence in depth, and it's also load-bearing — the column has to be populated for the policy to have anything to compare against.

**The transactional outbox.** Writing the event in the same transaction as the state change, a relay that marks dispatched only after the broker confirms, capped retries with backoff, and a dead-letter table. That is the textbook solution to dual-write and it's implemented correctly. The at-least-once delivery it produces is deliberate, not a flaw — which is exactly why the consumer-side dedup key in finding 6 matters, and fixing that key leaves this section genuinely good. The author says this is the part they're happy with. They're right.

**`custom_fields jsonb` rather than EAV tables.** JSONB columns get flagged reflexively as a schema smell. Here it's the right call for the stated requirement, and the reason is that they kept `field_definitions` as real relational metadata instead of inferring the schema from whatever happens to be in the documents — so the definition is authoritative, validatable, and queryable, and the JSONB is only storage. The limitation is filtering and sorting on custom fields, which will need GIN indexes or expression indexes when "one more filter" arrives, and there's no story yet for what happens to stored data when a field is renamed, retyped, or deleted. But the choice itself is sound.

**The web UI being a client of the same API, with no separate backend.** Reads like a shortcut taken by someone working alone, and the author frames it that way. It's a good decision independently: one authorization surface instead of two, and no chance of the two disagreeing about who may see what — which matters a great deal given finding 3.

---

## What I'd fix first

**Finding 1 — the tenant context.**

Not because it's the most severe in the abstract. Findings 2 and 3 are also critical, and finding 3 is leaking data *right now, every day*, while finding 1 may or may not be live depending on what `db` actually is in the code.

I'd pick it anyway, for four reasons:

**The blast radius is categorically different.** Finding 3 exposes Client C's clinical notes to Client C's own reception staff — serious, legally exposed, but a bounded group who already work for the clinic and are already inside its confidentiality regime. Finding 1 exposes Client C's patient data to Client A's call-centre operators: a different organisation, no relationship, no lawful basis. For a platform whose entire economic argument is "every client in one database," a cross-tenant leak isn't a bug, it's the end of the product. That's the one you cannot be found to have known about and deferred.

**It's silent.** Findings 2 and 3 leak data to people who are at least meant to be near it, through screens someone designed. Finding 1 returns another tenant's rows through a normal API call with a 200 and no log line. Nobody reports it because nothing looks broken. It could be happening today and there'd be no signal — which also means the first evidence you get is likely to be a customer telling you, which is the worst way to learn it.

**It gets worse as they grow, and they're growing next month.** Whether the wrong connection gets picked up is a scheduling race; more concurrency, more tenants, more requests per connection, higher odds. Every other finding here degrades gracefully. This one degrades exactly as the business succeeds.

**It's hours, not weeks.** The fix is `set_config(..., true)`, one client per request threaded through the handlers, and a two-tenant test over a single-connection pool. Finding 3's real fix — field-level permissions as configuration — is a design project measured in weeks, and finding 2 needs a backfill. Highest risk removed per hour of work is finding 1, by a wide margin, and shipping it doesn't block starting the other two.

Concretely, day one: confirm what `db` is in the real code, because if handlers and `setTenantContext` share a connection then this is latent rather than live and the ordering changes. That check is under an hour. If it's live, I'd ship the fix same-day, then immediately patch `SELECT *` down to a role-scoped column list as a stopgap for finding 3 while the permissions design gets done properly — that patch is also a day, and it takes the clinic out of active disclosure without pretending the design problem is solved.

---

## Questions I'd ask before acting

The brief says asking costs nothing, so:

1. Is `db` in Sections 4 and 5 the pool or the per-request client? It decides whether finding 1 is live or latent, and it is the single fact that most changes my ordering.
2. Where do uploaded files actually live, and is retrieval authenticated? Section 7 doesn't say, and it's the largest undescribed piece of the isolation story.
3. Does Client A's confirmation SMS on create exist in the code, or is the brief right that the message is only sent on Resolved?
4. Is the Client B eligibility scoring engine built? It appears nowhere in the architecture document despite being the most complex logic on the platform.
5. Has a restore from backup ever been performed?
