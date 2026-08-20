import { useState } from 'react'

/**
 * Publishes the transcript exports in submission/transcripts/ verbatim.
 *
 * Files are emitted as static assets rather than inlined into the bundle, and
 * fetched the first time a reader opens one — a full session export is large, and
 * nobody should pay for it on page load.
 *
 * Drop a new .txt export into the folder and it appears here. `TITLES` is only for
 * names that don't survive hyphen-to-space conversion; anything unlisted falls
 * back to its filename.
 */
const URLS = import.meta.glob('../../../submission/transcripts/*.txt', {
  query: '?url',
  import: 'default',
  eager: true,
})

const TITLES = {
  '01-designing-the-submission-page': 'Designing the submission page',
  '02-part-2-cross-field-validation': 'Part 2 — cross-field validation',
}

function nameOf(filePath) {
  return filePath.split('/').pop().replace(/\.txt$/, '')
}

const TRANSCRIPTS = Object.entries(URLS)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([filePath, url]) => {
    const name = nameOf(filePath)
    return {
      name,
      url,
      title: TITLES[name] || name.replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' '),
    }
  })

function Transcript({ transcript, index }) {
  const [state, setState] = useState({ status: 'idle', text: '' })

  function load() {
    if (state.status !== 'idle') return
    setState({ status: 'loading', text: '' })
    fetch(transcript.url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => setState({ status: 'ready', text }))
      .catch(() => setState({ status: 'error', text: '' }))
  }

  return (
    <details
      className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
      onToggle={(event) => event.currentTarget.open && load()}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-100">
        <span>
          <span className="mr-2 font-mono text-xs text-slate-500">
            {String(index + 1).padStart(2, '0')}
          </span>
          {transcript.title}
        </span>
        <span className="shrink-0 text-xs font-normal text-slate-500">
          <a
            href={transcript.url}
            download={`${transcript.name}.txt`}
            onClick={(event) => event.stopPropagation()}
            className="mr-3 text-sky-700 hover:underline"
          >
            raw
          </a>
          <span className="inline-block transition-transform group-open:rotate-90">›</span>
        </span>
      </summary>

      <div className="border-t border-slate-200">
        {state.status === 'ready' ? (
          <pre className="max-h-[36rem] overflow-auto bg-slate-900 p-4 text-[12px] leading-5 text-slate-100">
            {state.text}
          </pre>
        ) : (
          <p className="px-4 py-6 text-sm text-slate-500">
            {state.status === 'error' ? 'Could not load this transcript.' : 'Loading transcript…'}
          </p>
        )}
      </div>
    </details>
  )
}

export default function Transcripts() {
  if (TRANSCRIPTS.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
        No transcripts published yet. Drop the exported <code>.txt</code> files into{' '}
        <code>submission/transcripts/</code> and they will appear here.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">The transcripts</h2>
      <p className="text-[15px] leading-7 text-slate-600">
        Exported from Claude Code and published unedited. Open one to read it in place, or use{' '}
        <span className="font-medium text-sky-700">raw</span> to download the file.
      </p>
      {TRANSCRIPTS.map((transcript, index) => (
        <Transcript key={transcript.name} transcript={transcript} index={index} />
      ))}
    </div>
  )
}
