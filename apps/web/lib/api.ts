import axios, { type AxiosInstance } from 'axios';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export function createApiClient(accessToken?: string): AxiosInstance {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}
