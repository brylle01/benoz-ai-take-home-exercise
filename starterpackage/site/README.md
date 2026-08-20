# Submission page

The single hosted page for the take-home. React + Tailwind CSS, built with Vite,
deploys as static files.

## The content lives in markdown, not in JSX

`src/App.jsx` imports four files with Vite's `?raw` suffix:

```
../submission/part1-handover-review.md   Part 1 — handover review
../submission/part2-code.md              Part 2 — link to the code
../submission/part3-decisions.md         Part 3 — the three decisions
../submission/part4-ai-usage.md          Part 4 — AI transcripts
```

To finish the submission, edit those markdown files. Nothing in `src/` needs to change.
Parts 2, 3 and 4 are currently stubs marked **TODO**.

## Local

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
npm run preview  # serve the built output
```

## Publishing

`vite.config.js` sets `base: './'`, so the build works from any path — a GitHub Pages
project site, a Netlify subpath, anywhere.

- **GitHub Pages** — `.github/workflows/deploy-pages.yml` at the repo root builds and
  deploys on every push to `main`. Enable it once under *Settings → Pages → Source →
  GitHub Actions*.
- **Netlify** — `netlify.toml` at the repo root already points at this directory.
  `netlify deploy --prod` from the repo root, or connect the repo in the UI.
- **Vercel** — import the repo and set the root directory to `starterpackage/site`.
- **Anything else** — `npm run build` and upload `dist/`.

Whichever you use, the page must be reachable without a login. Check it in a private
window before sending the link.
