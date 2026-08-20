import Nav from './components/Nav.jsx'
import Section from './components/Section.jsx'
import Transcripts from './components/Transcripts.jsx'

// The markdown under ../submission is the single source of truth for this page.
// Edit those files and the page updates — no JSX changes needed.
import part1 from '../../submission/part1-handover-review.md?raw'
import part2 from '../../submission/part2-code.md?raw'
import part3 from '../../submission/part3-decisions.md?raw'
import part4 from '../../submission/part4-ai-usage.md?raw'

const PARTS = [
  {
    id: 'part-1',
    navLabel: 'Part 1 — Review',
    kicker: 'Part 1',
    title: 'Review of the handover document',
    summary:
      'What I found in the contractor’s architecture notes, ranked by severity, plus the decisions that look wrong and are not.',
    source: part1,
  },
  {
    id: 'part-2',
    navLabel: 'Part 2 — Code',
    kicker: 'Part 2',
    title: 'The code',
    summary: 'Cross-field validation added to the definition format and the library.',
    source: part2,
  },
  {
    id: 'part-3',
    navLabel: 'Part 3 — Decisions',
    kicker: 'Part 3',
    title: 'Three decisions',
    summary:
      'Isolation, where the eligibility score lives, and what breaks first at 300 clients — each with what it costs and who it loses.',
    source: part3,
  },
  {
    id: 'part-4',
    navLabel: 'Part 4 — AI use',
    kicker: 'Part 4',
    title: 'AI transcripts and how I used them',
    summary:
      'What I used, a suggestion I rejected, where the tools helped least, and the full unedited exports.',
    source: part4,
  },
]

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Benoz.AI — take-home exercise
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Platform Foundation — submission
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Everything for this exercise is on this page: the handover review, a link to the code,
            the three decisions, and my account of how I used AI.
          </p>
          <dl className="mt-8 grid gap-4 sm:grid-cols-4">
            {PARTS.map((part) => (
              <div key={part.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {part.kicker}
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  <a href={`#${part.id}`} className="hover:text-sky-700">
                    {part.title}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <Nav parts={PARTS} />

      <main className="mx-auto max-w-4xl px-6 pb-24">
        {PARTS.map((part) => (
          <Section key={part.id} {...part}>
            {part.id === 'part-4' && <Transcripts />}
          </Section>
        ))}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-8 text-sm text-slate-500">
          Submitted by elbryllepagasian736@gmail.com · built with React, Tailwind CSS and Vite
        </div>
      </footer>
    </div>
  )
}
