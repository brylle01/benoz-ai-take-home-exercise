import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // the markdown under ../submission is the source of truth for the page
    fs: { allow: ['..'] },
  },
})
