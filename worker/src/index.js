// src/index.js
import "dotenv/config";
import { runFullScan }                    from "./jobs/scanJob.js";
import { runSyncQuotes, runSyncHistory }  from "./jobs/dataJob.js";
import pool from "./db.js";

console.log("🚀 Borsa Pro Worker başladı");
console.log(`   Node: ${process.version}`);
console.log(`   ENV:  ${process.env.NODE_ENV || "development"}\n`);

// Artık zamanlayıcı YOK — GitHub Actions bunu 17:25 TRT'de
// (.github/workflows/scan.yml) ve istendiğinde tetikliyor.
//
// Kullanım:
//   node src/index.js --sync    → Fiyatları hemen güncelle
//   node src/index.js --scan    → Taramayı hemen başlat
//   node src/index.js --history → 1 yıllık geçmiş veriyi çek

const args = process.argv.slice(2);

async function main() {
  if (args.includes("--sync")) {
    await runSyncQuotes();
  }
  if (args.includes("--scan")) {
    await runFullScan();
  }
  if (args.includes("--history")) {
    await runSyncHistory("1y");
  }
  if (!args.length) {
    console.log("⚠️  Hiçbir bayrak verilmedi. Kullanım: --sync | --scan | --history");
  }
}

main()
  .then(() => {
    console.log("\n✅ İşlem tamamlandı, çıkılıyor.");
    return pool.end();
  })
  .catch((err) => {
    console.error("\n❌ Hata:", err);
    return pool.end().finally(() => process.exit(1));
  });