import { useEffect, useState } from 'react'

/** Sticky part-navigation that highlights whichever section is on screen. */
export default function Nav({ parts }) {
  const [active, setActive] = useState(parts[0].id)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 },
    )

    for (const part of parts) {
      const el = document.getElementById(part.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [parts])

  return (
    <nav className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-6 py-3">
        {parts.map((part) => (
          <a
            key={part.id}
            href={`#${part.id}`}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active === part.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
            }`}
          >
            {part.navLabel}
          </a>
        ))}
      </div>
    </nav>
  )
}
