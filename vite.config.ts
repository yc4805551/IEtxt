import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // Set the base path for deployment to the specific GitHub repository.
  base: '/IEtxt/',
  plugins: [react()],
  // This makes the environment variable available in your client-side code
  // by replacing `process.env.API_KEY` with the value of the API_KEY
  // environment variable from the build process.
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
})
