// api/src/index.js
// Sadece YEREL geliştirme için (npm run dev). Vercel bu dosyayı kullanmıyor,
// kök dizindeki api/index.js'i kullanıyor (app.js'i doğrudan export ediyor).

import app from "./app.js";

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`\n🚀  Borsa Pro API çalışıyor → http://localhost:${PORT}`);
  console.log(`📋  Sağlık kontrolü      → http://localhost:${PORT}/health\n`);
});