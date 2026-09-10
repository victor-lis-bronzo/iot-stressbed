import axios, { type AxiosInstance } from 'axios';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Base URL do Grafana provisionado (dashboards Track B). Usada para montar
// links que abrem um dashboard em nova aba (ver AttackResult.tsx) — nunca em
// iframe, já que o Grafana exige login em toda rota (ADR-0005) e
// GF_AUTH_ANONYMOUS_ENABLED=false.
export const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3001';

// Só para chamadas server-side (ex: authorize() do NextAuth). NEXT_PUBLIC_API_URL
// é resolvida no browser via porta publicada no host; dentro do container
// nextjs-web isso aponta para o próprio processo, não para o nestjs-api.
export const INTERNAL_API_BASE_URL = process.env.API_INTERNAL_URL || API_BASE_URL;

export function createApiClient(accessToken?: string): AxiosInstance {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}
