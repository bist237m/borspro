// src/api/client.js
// Geliştirmede Vite proxy (/api → localhost:3001)
// Production'da VITE_API_URL env değişkeni kullanılır

const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "/api";

function getToken() {
  return localStorage.getItem("bp_token");
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "Sunucu hatası");
    err.status = res.status;
    throw err;
  }
  return data;
}

export const auth       = { register: b => request("POST","/auth/register",b), login: b => request("POST","/auth/login",b), me: () => request("GET","/auth/me") };
export const stocks     = { list: (p={}) => request("GET",`/stocks${p&&Object.keys(p).length?"?"+new URLSearchParams(p):""}`), get: s => request("GET",`/stocks/${s}`), history: (s,p) => request("GET",`/stocks/${s}/history?period=${p}`) };
export const portfolios = { list: () => request("GET","/portfolios"), create: b => request("POST","/portfolios",b), remove: id => request("DELETE",`/portfolios/${id}`), positions: id => request("GET",`/portfolios/${id}/positions`), transactions: id => request("GET",`/portfolios/${id}/transactions`), addTransaction: (id,tx) => request("POST",`/portfolios/${id}/transactions`,tx) };
export const watchlists = { list: () => request("GET","/watchlists"), items: id => request("GET",`/watchlists/${id}/items`), addItem: (id,sid) => request("POST",`/watchlists/${id}/items`,{stock_id:sid}), removeItem: (id,iid) => request("DELETE",`/watchlists/${id}/items/${iid}`) };
export const alerts     = { list: () => request("GET","/alerts"), create: b => request("POST","/alerts",b), remove: id => request("DELETE",`/alerts/${id}`) };
export const news       = { list: (p={}) => request("GET",`/news${p&&Object.keys(p).length?"?"+new URLSearchParams(p):""}`) };
export const calendar   = { list: (p={}) => request("GET",`/calendar${p&&Object.keys(p).length?"?"+new URLSearchParams(p):""}`) };
export const jobs       = { scan: () => request("POST","/jobs/scan"), sync: () => request("POST","/jobs/sync"), status: id => request("GET",`/jobs/${id}`), overview: () => request("GET","/jobs/status/overview") };
