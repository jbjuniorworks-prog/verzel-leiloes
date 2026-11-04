import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Testes de componente rodam num DOM simulado (jsdom).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
  },
});
