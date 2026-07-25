import { verifyToken } from "../utils/jwt.js";

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token bulunamadı." });
  }

  try {
    const token = header.split(" ")[1];
    req.user = verifyToken(token);   // { id, email, plan }
    next();
  } catch {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş token." });
  }
}
