# Part 4 — AI transcripts and how I used them

Two full exports are published below, unedited. The brief asks for the real
conversations rather than a summary of them, so nothing has been tidied — including
the parts where a heredoc silently failed to write a file, where a build broke three
times against a stale file lock, and where the model wrote a glob path one directory
too shallow and had to be caught by checking whether the content had actually made
it into the bundle.

> **[CONFIRM]** Three passages below are marked like this. They are first-person
> claims about my own judgment that nobody can make for me. Each one is either
> still mine to write, or drafted from what is visible in the published transcripts
> and needing my sign-off. Anything still marked when you read this is unfinished —
> treat it as a gap, not as a claim.

## What I used, and for what

| Tool | Model | What it did |
|---|---|---|
| Claude Code (CLI) v2.1.236 | Claude Opus 5 | **Transcript 01** — designing and building this page: React 18, Tailwind CSS v4, Vite, with all four parts rendered from markdown so the content and the presentation stay separable. |
| Claude Code (CLI) v2.1.236 | Claude Opus 5 | **Transcript 02** — Part 2: the cross-field rule format, `lib/validate.js`, `validateDefinition`, 31 new tests, and the README specification. |

The division of labour is visible in the transcripts rather than asserted here. I
set the task and the constraints, the model read the starter package and proposed a
design, and I directed where it stopped — which, for Part 2, is the whole
deliverable.

## A suggestion I rejected, and why

> **[CONFIRM]** Mine to write, and not yet written. The brief wants one concrete
> proposal and the specific reason it was wrong — not "AI sometimes hallucinates."
>
> The clearest candidate in the published record is in transcript 01: the model
> duplicated `part1-handover-review.md` into `site/src/content/` so the page could
> import it, then reversed itself and imported from `submission/` instead. Two
> copies of one document with nothing keeping them in step is a document that goes
> stale silently, and the page would have kept rendering the old copy without
> complaint.
>
> If the real answer is a design suggestion I turned down during Part 2 — a richer
> rule format, an expression evaluator, a `not` operator, arithmetic — that is a
> stronger answer and belongs here instead.

## Where the tools helped least

> **[CONFIRM]** Drafted from what is observable in the published transcripts. Keep
> what is true of you, cut what is not, and put it in your own words. There is a
> follow-up conversation about exactly this.

Two kinds of unhelpfulness showed up, and only one is worth reporting.

The shallow kind is mechanical friction, and the transcripts are full of it: a
heredoc that failed to write a file on Windows and was only caught by checking the
line count afterwards; a `vite build` that failed three times against a file lock
left by a preview server the model had started and believed it had stopped; a
`import.meta.glob` path one directory too shallow, which silently matched nothing
and produced a page with no transcripts on it and no error anywhere. That last one
is the instructive version of the shallow problem — the failure mode of a
confident tool is not a crash, it is a plausible result that is quietly empty. It
was caught by grepping the built bundle for a string that should have been in it,
which is a habit rather than a tool.

The kind worth reporting: **the tools were least useful at exactly the decision this
exercise is grading — where to stop.** Part 2's real deliverable is not the rule
format, it is the boundary: comparison between fields, never arithmetic. Every
operator past that line looks locally reasonable, and each one is defensible on its
own terms, so a model asked to improve a format will keep adding them. Nothing in
the tool says *stop here, and here is the sentence that justifies the line.* Drawing
that line, and being able to defend it against the next reasonable-sounding
addition, is the part I had to own.

The second-order version, also visible in the record: a model will not tell you
which facts it is missing. The exercise brief was not in the starter package, and
the work stalled until the file was found and read rather than guessed at.

## What I left out, and what I'm least confident about

> **[CONFIRM]** Drafted from what the work does and does not cover. Verify each
> claim still holds and add anything thin that is not listed.

Left out, deliberately and otherwise:

- **Part 2 stops at comparison.** No arithmetic, no date-window operator (`within
  90 days` is the most obvious rule the format cannot express), no cross-record
  lookup, and no escape hatch to a named validator in code. I argued the line
  rather than hedging it, which means if the definition file you test against needs
  arithmetic, my format fails your test — and my README will at least have told you
  why in advance.
- **Decision 1 is committed but not costed.** The $40–80/month per-instance figure
  is an estimate, not a model, and the operational load of 300 separate deployments
  is the part I can reason about but not defend from experience.
- **Decision 2 assumes** the board's annual revision cycle leaves room for a code
  change plus a backtest. If that assumption is wrong the design is wrong, and I
  say so in the answer rather than stretching it to fit.
- **No screenshot or browser check** of this page beyond building it and verifying
  the content is in the bundle.

Least confident: **Decision 1.** I believe the direction-of-travel argument — that
shared-to-dedicated is a rewrite while dedicated-to-cheaper is optimisation — and I
believe a regulator asking about infrastructure control cannot be satisfied by
row-level security. What I have not done is operate a fleet of 300 anything, so the
strongest objection to my own answer (that 300 drifting instances is a worse
security outcome than one shared instance patched on time) is one I put on the
record in Decision 1 precisely because I cannot close it from experience. It is the
first thing I would want to be argued with about.
