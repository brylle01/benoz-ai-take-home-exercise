import Doc from './Doc.jsx'

/**
 * One part of the submission: a labelled band with the markdown rendered inside.
 * `id` is the anchor the nav links to.
 */
export default function Section({ id, kicker, title, summary, source, children }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-200 py-14 first:border-t-0">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">{kicker}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h2>
        {summary && <p className="mt-3 max-w-2xl text-slate-600">{summary}</p>}
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        {source && <Doc>{source}</Doc>}
        {children}
      </div>
    </section>
  )
}
