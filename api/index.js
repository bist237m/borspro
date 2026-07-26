// api/index.js
// Vercel'in serverless function olarak çalıştıracağı giriş dosyası.
// Express app'i (app.listen() içermeyen hali) doğrudan export ediyoruz —
// Vercel bunu her istekte bir fonksiyon gibi çağırıyor.

import app from "./src/app.js";

export default app;