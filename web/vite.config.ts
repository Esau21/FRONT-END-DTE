import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // API de Go (SMPT-DTE). Se puede cambiar con API_TARGET en web/.env.local
  const target = env.API_TARGET || 'http://localhost:8080'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // El puerto debe coincidir con AFTER_LOGIN_PATH del backend
      strictPort: true,
      // Todo /api va al backend: mismo origen para el navegador, así la
      // cookie de sesión (Path=/api, SameSite=Lax) viaja sin necesitar CORS.
      proxy: {
        '/api': { target, changeOrigin: false },
      },
    },
  }
})
