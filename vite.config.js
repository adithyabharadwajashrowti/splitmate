import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH lets the same code run at the root (Netlify, localhost) or under /splitmate/ (GitHub Pages)
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
