// Baseline load: 20 virtual users browsing read endpoints for 1 minute.
// Run: k6 run tests/load/api-baseline.js  (stack must be up)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_URL || 'http://localhost:4000';

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '45s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export function setup() {
  const res = http.post(`${BASE}/api/demo/sessions`);
  return { session: res.json('id') };
}

export default function ({ session }) {
  const params = { headers: { 'x-pulsegrid-session': session } };
  const endpoints = ['/api/services', '/api/traces?limit=25', '/api/alerts', '/api/incidents', '/api/dead-letter'];
  for (const p of endpoints) {
    const res = http.get(`${BASE}${p}`, params);
    check(res, { [`${p} 200`]: (r) => r.status === 200 });
  }
  sleep(1);
}
