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

export const auth       = { register: b => request("POST","/auth/register",b), login: b => request("POST","/auth/login",b), me: () => request("GET","/auth/me"), updateMe: b => request("PATCH","/auth/me",b), changePassword: b => request("POST","/auth/change-password",b) };
export const stocks     = { list: (p={}) => request("GET",`/stocks${p&&Object.keys(p).length?"?"+new URLSearchParams(p):""}`), get: s => request("GET",`/stocks/${s}`), history: (s,p) => request("GET",`/stocks/${s}/history?period=${p}`), filters: s => request("GET",`/stocks/${s}/filters`), fundamentals: s => request("GET",`/stocks/${s}/fundamentals`), news: s => request("GET",`/stocks/${s}/news`) };
export const portfolios = { list: () => request("GET","/portfolios"), create: b => request("POST","/portfolios",b), remove: id => request("DELETE",`/portfolios/${id}`), update: (id,b) => request("PATCH",`/portfolios/${id}`,b), positions: id => request("GET",`/portfolios/${id}/positions`), transactions: id => request("GET",`/portfolios/${id}/transactions`), addTransaction: (id,tx) => request("POST",`/portfolios/${id}/transactions`,tx), cashTransactions: id => request("GET",`/portfolios/${id}/cash-transactions`), addCash: (id,tx) => request("POST",`/portfolios/${id}/cash`,tx) };
export const watchlists = { list: () => request("GET","/watchlists"), items: id => request("GET",`/watchlists/${id}/items`), addItem: (id,sid) => request("POST",`/watchlists/${id}/items`,{stock_id:sid}), removeItem: (id,iid) => request("DELETE",`/watchlists/${id}/items/${iid}`) };
export const alerts     = { list: () => request("GET","/alerts"), create: b => request("POST","/alerts",b), remove: id => request("DELETE",`/alerts/${id}`) };
export const news       = { list: (p={}) => request("GET",`/news${p&&Object.keys(p).length?"?"+new URLSearchParams(p):""}`) };
export const calendar   = { list: (p={}) => request("GET",`/calendar${p&&Object.keys(p).length?"?"+new URLSearchParams(p):""}`) };
export const jobs       = { scan: () => request("POST","/jobs/scan"), sync: () => request("POST","/jobs/sync"), status: () => request("GET","/jobs/status"), overview: () => request("GET","/jobs/status/overview") };
export const signals    = { tracked: () => request("GET","/signals/tracked") };
export const market      = { ticker: () => request("GET","/market/ticker") };
export const ai = { comment: symbol => request("POST",`/ai/stocks/${symbol}/comment`), history: symbol => request("GET",`/ai/stocks/${symbol}/comment/history`), allCommentary: () => request("GET","/ai/commentary") };
