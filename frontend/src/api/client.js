import API_BASE_URL from '../config.js';

// JSON fetch for the account and admin APIs: always sends the session cookie
// (credentials: 'include' - without it every call is "Not signed in") and
// turns an error response into a thrown Error carrying the server's message.
export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `${API_BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status}).`);
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
