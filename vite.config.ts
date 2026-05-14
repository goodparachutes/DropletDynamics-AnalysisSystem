import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub project pages are served under /<repo-name>/; set VITE_BASE_PATH in CI (see .github/workflows).
const base = process.env.VITE_BASE_PATH?.replace(/\/?$/, '/') ?? '/'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
})
