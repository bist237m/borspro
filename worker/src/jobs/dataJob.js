// src/jobs/dataJob.js
// Artık Bull processor değil, doğrudan çağrılan fonksiyonlar.

import { fetchAndSyncAllStocks, fetchAllHistory } from "../services/dataFetcher.js";

// Tüm hisselerin anlık fiyatını güncelle
export async function runSyncQuotes() {
  console.log(`\n📡 [${new Date().toLocaleTimeString("tr-TR")}] Fiyat güncelleme başladı`);
  const result = await fetchAndSyncAllStocks();
  return result;
}

// Tüm hisselerin geçmiş verisini doldur
export async function runSyncHistory(period = "1y") {
  console.log(`\n📅 Geçmiş veri senkronizasyonu (${period}) başladı`);
  const result = await fetchAllHistory(period);
  return result;
}