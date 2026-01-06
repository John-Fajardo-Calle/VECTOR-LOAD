import axios from 'axios'

const baseURL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000'

export const api = axios.create({
  baseURL,
  timeout: 120000,
})

/**
 * Request a new synthetic dataset from the backend.
 *
 * Dataset generation stays on the backend so I can evolve defaults/schema without
 * redeploying the frontend.
 */
export async function simulate({ num_skus, seed, truck }) {
  const { data } = await api.post('/api/simulate', { num_skus, seed, truck })
  return data
}

/**
 * Generate a new dataset while allowing the backend to replace/cleanup a previous one.
 */
export async function simulateReplacing({ num_skus, seed, truck, previous_dataset_id }) {
  const { data } = await api.post('/api/simulate', { num_skus, seed, truck, previous_dataset_id })
  return data
}

/**
 * Run optimization via backend -> engine.
 *
 * The frontend talks to the backend only; the backend owns timeouts/error mapping and
 * leaves room for auth/rate limits later.
 */
export async function optimize({ dataset_id, truck, boxes, params }) {
  const { data } = await api.post('/api/optimize', { dataset_id, truck, boxes, params })
  return data
}

export async function runTests() {
  const { data } = await api.post('/api/tests/run', {})
  return data
}

export async function resetAll() {
  const { data } = await api.post('/api/reset', {})
  return data
}
