/// <reference types="node" />

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env variables from .env files.
  // The third parameter '' makes it load all variables, not just those prefixed with VITE_.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    // Set the base path for deployment to the specific GitHub repository.
    base: '/IEtxt/',
    plugins: [react()],
    // This makes the environment variable available in your client-side code
    // as process.env.API_KEY.
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  }
})
