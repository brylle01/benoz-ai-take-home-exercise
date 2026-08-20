# Part 3 — Three decisions

## Decision 1 — Isolation

**One client, one deployment, one database. Every client, including the ones who
don't need it.**

The platform ships as a single deployable unit — application, database, worker,
scheduler — provisioned from one artifact by one pipeline. Client C's unit runs on
the clinic's infrastructure. Client A's runs on ours. Client D's runs wherever the
contract says. The deployment *target* is a provisioning parameter; the
architecture is identical in every case, and no two clients ever share a database.

**This is not a hybrid.** A hybrid would be two architectures — pooled for the
cheap clients, dedicated for the regulated one — and two architectures means two
authorization surfaces, two migration paths, and two chances to leak. There is one
topology here. Client A gets a dedicated stack they didn't ask for and don't need,
and paying for that is the cost of the decision, not a hedge against it.

**Why this way round.** The clinic's requirement is a hard constraint and the
others are soft ones. You cannot engineer your way to "under the clinic's own
control" from a shared database — row-level security is a software guarantee, and
the regulator is asking about infrastructure. There is no `WHERE tenant_id` clause
that answers them. Cost and setup speed, by contrast, are ordinary engineering
problems with known solutions: automation, right-sizing, a provisioning pipeline.
Same-day setup for a new client on our own infrastructure is a Terraform run and a
migration, and that is achievable.

The asymmetry that actually decides it is the direction of the one-way door.
Shared-to-dedicated is a rewrite of the data layer, the auth layer and the
deployment story. Dedicated-to-cheaper is optimisation you can do any Tuesday. And
the fourth client is unknown, which means the question is not "does Client C need
this" but "what fraction of nonprofits, foundations and **public bodies** come with
a data-residency or infrastructure clause." In that sector it is not a small
fraction, and Client C is not an outlier — Client C is a preview.

The failure modes are asymmetric too. Get the shared design wrong and the failure
is a cross-tenant leak — silently returning the clinic's patients to Client A's
call-centre operators, which is Finding 1 of my Part 1 review and the end of the
company. Get the dedicated design wrong and the failure is that margins are worse
than forecast.

**What I'm giving up, and who I lose.**

I lose the bottom of the market, and I should be specific: a dedicated managed
Postgres plus a container is somewhere around $40–80 a month before anyone touches
it, so there is a price floor beneath which a client is unprofitable. Every client
below it is gone. That means no self-serve motion, no free tier, no small
grassroots nonprofit signing up on a Tuesday afternoon — Benoz becomes a sales-led
business with a floor price, and that is a different company from the one a pooled
design could have been. **If Client A's "lowest possible cost" is a hard budget
rather than a preference, I lose Client A**, and I would rather lose them at the
proposal stage than discover in year two that the platform cannot take a regulated
client without being rebuilt.

I also give up cheap cross-client reporting (there is no one database to query),
and cheap operations. One migration becomes 300 migrations, and one of them will
fail. That is a real cost, I am not going to pretend otherwise, and it is why my
answer to Decision 3 is the one it is.

**The strongest argument against me**, which I want on the record because I expect
it in the follow-up: 300 separately-deployed instances is 300 things that drift,
and an unpatched instance is a worse security outcome than a shared instance that
is patched on time. That argument is correct, and it is the thing this decision
must be judged on. It is survivable only if fleet version state is a monitored,
alerting number from day one rather than something discovered later — which is
exactly Decision 3.

---

## Decision 2 — The eligibility score

**The formula lives in code, as a named and versioned scoring function. Its
parameters live in configuration, versioned per round. Its inputs are resolved and
stored before scoring runs, by a separate step that is allowed to fail.**

The mistake available here is treating "the eligibility score" as one thing. It is
four, and they change at four different rates:

| Part | Changes | Lives in |
|---|---|---|
| Thematic weights, threshold, recency decay | Every round — 4×/year | Configuration, per round |
| The shape of the formula | ~Annually, by the board | Code, versioned |
| Turnover from the registry API, past-grant history | Per application | Resolved once, stored on the record |
| Auto-reject below threshold | Rarely | The workflow state machine, not the scorer |

**Why the formula is code and not data.** This is the same boundary I drew in
Part 2 and for the same reason. The score is arithmetic over derived quantities
with an external dependency — a definition format that can express it *is* a
programming language, and I would be building an expression evaluator with a
parser, a precedence table and a security review. Worse, this formula
auto-rejects real applicants, so its correctness has legal weight. Code gives me
tests, review and a diff. A configurable formula gives me a field in an admin
screen where a typo silently rejects forty organisations and nobody can tell
whether the bug is in the engine or the configuration.

**Why the inputs are resolved separately and stored.** The registry API will be
down at the worst moment — the deadline, when every applicant submits at once. If
scoring calls it inline, scoring fails when the registry fails. So input resolution
is its own step, retried, with the returned turnover **stored on the application
alongside the timestamp and the registry's response**. Scoring then becomes a pure
function of stored inputs and frozen parameters: re-runnable, unit-testable, and
explainable three years later when someone appeals. "Why was I rejected" must be
answerable with the exact numbers used on the day, not with today's re-fetch of a
figure that has since changed.

**When the board changes it.** Weights and thresholds: a new round record, filled
in through a form, no deploy — and **frozen when the round opens**, with each score
recording which parameter version produced it. Grant-making foundations get
appeals; a score you cannot reconstruct is a score you cannot defend.

A change to the formula's *shape* ships as a new version, `score_v4`, **alongside**
`score_v3` rather than replacing it. Each round names the version it uses, and
applications keep the version that judged them. The deliverable of a formula change
is not the code diff — it is a **backtest against the previous round**, showing the
board exactly which applicants would have been rejected who weren't, and which
would have survived who didn't. That is the thing they need to see and cannot get
from a formula on paper. An annual revision with months of notice fits a week of
work comfortably. If the board revised monthly this answer would be wrong, and I
would say so rather than pretend the design stretched.

**When Client C asks for something similar but different.** I write a second named
scorer, and I do not generalise.

Their version — triage urgency, presumably — shares almost nothing with Client B's:
different inputs, a different external dependency or none, a different consequence
(a clinical priority, not a rejection), and a completely different regulatory
weight attached to being wrong. What the two share is *shape*: resolve inputs →
compute a number → drive a transition. So the shape is what I extract — the
pipeline around the formula: input resolution with retries and caching, parameter
versioning and freezing, score storage with a per-term breakdown, the backtest
harness, the transition hook. That is the genuinely reusable part and the expensive
part to get right. Client C plugs a second scorer into it.

The cost I am accepting is that a third client means a third scoring function in
the codebase. I would rather have three tested functions than one DSL that nobody
can backtest. I'd revisit at the **fourth** client: if by then three scorers have
turned out to be the same weighted sum with different weights, that is evidence for
a generic weighted-sum scorer as configuration — three instances of a pattern, not
two. Same discipline as Part 2's stopping line, applied to the same kind of
temptation.

---

## Decision 3 — What breaks first at 300 clients

**The release pipeline — specifically, schema migration across the fleet.**

Under Decision 1 every runtime component is per-client and therefore scales
linearly by construction. One database serves one client. One relay serves one
client. Client A's storm afternoon is Client A's problem and nobody else's. The
usual answer to this question — the shared database, the shared queue — does not
apply here, because I removed the shared thing on purpose. What I could not remove
is the release process: **one artifact, one migration set, applied 300 times.** It
is the only component whose work grows with client count and the only one whose
failure is correlated across every client at once.

**Why it fails.** Migrations drift. One client's table is ten times the size of
everyone else's and the lock times out. One instance was mid-maintenance during the
rollout and never got it. One migration is not idempotent, so the retry fails
differently from the original. And version skew between application and schema is
only ever tested for the version pair someone had in mind. At three clients you
eyeball it; at thirty you script it; at 300 a **1% per-instance failure rate is
three broken clients on every release** — and releases are frequent here, because
all three clients "request small changes constantly."

**What you'd see.** Not an outage, which is the whole problem. The deploy reports
success. The dashboard is green. Then a support ticket from one client saying the
new filter doesn't work, and two days later a different ticket from a different
client with a different symptom. Somewhere in one of 300 per-instance log streams
that nobody is tailing, `column "x" does not exist`. Time-to-detect measured in
days, discovered by customers rather than by us.

Then it compounds, which is the part that actually hurts. You now have 280
instances on version 12 and 20 on version 11, so release 13 has to be safe against
both — and it won't be, because nobody wrote it that way. The number that tells you
this is happening is *instances on the current version*, and it is a number nobody
tracks until it has already been 40 for a month.

**What I'd do**, cheapest and highest-leverage first:

1. **Make fleet version state a monitored number, before it is a problem.** A
   control-plane view of every instance's application version and schema version,
   alerting on any instance more than one version behind for more than 24 hours.
   This is a day's work and it converts a silent failure into a loud one, which is
   the single highest-value change on this list.
2. **Expand/contract migrations, enforced.** Every schema change is
   backwards-compatible with the previous application version; the destructive half
   ships a release later. This makes skew *safe* rather than merely rare, which is
   the only property that scales to 300. Enforced by a CI job that runs the previous
   release's test suite against the new schema.
3. **Staged rollout that halts on failure.** Canary ring, then 10%, then the rest,
   stopping on the first failure rather than continuing. A bad release should reach
   three clients, not 300.
4. **Reconciliation, not fire-and-forget.** The control plane continuously drives
   each instance toward the target version instead of running a deploy once and
   hoping. An instance that was down during the rollout catches up by itself, which
   removes the most common source of drift entirely.

**What this does not fix:** a migration that is simply slow against one large
client's data. That needs online backfill patterns — write to both, backfill in
batches, cut over, drop — and it is separate work I would not pretend the above
covers.
