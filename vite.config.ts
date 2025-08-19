import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Make the environment variable available in client-side code
    'process.env.API_KEY': `"${process.env.API_KEY}"`
  }
})
