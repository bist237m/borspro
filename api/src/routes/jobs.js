// api/src/routes/jobs.js
// Kullanıcıdan gelen on-demand tarama isteklerini artık Redis'e değil,
// GitHub Actions workflow'una (workflow_dispatch) iletir.
//
// Gerekli .env değişkenleri:
//   GITHUB_TOKEN         → GitHub Personal Access Token (repo + workflow izniyle)
//   GITHUB_OWNER         → GitHub kullanıcı adın
//   GITHUB_REPO          → repo adı (örn: borsa-pro)
//   GITHUB_WORKFLOW_FILE → scan.yml
//   GITHUB_REF           → dal adı, genelde "main"

import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_WORKFLOW_FILE = "scan.yml",
  GITHUB_REF = "main",
} = process.env;

const GH_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}`;

function ghHeaders() {
  return {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

// Workflow'u belirli bir "action" girdisiyle tetikler
async function dispatchWorkflow(action) {
  const res = await fetch(`${GH_API}/dispatches`, {
    method: "POST",
    headers: ghHeaders(),
    body: JSON.stringify({
      ref: GITHUB_REF,
      inputs: { action },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API hatası (${res.status}): ${text}`);
  }
}

// En son workflow çalışmasının durumunu getirir
async function getLatestRun() {
  const res = await fetch(
    `${GH_API}/runs?event=workflow_dispatch&per_page=1`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`GitHub API hatası (${res.status})`);
  const data = await res.json();
  return data.workflow_runs?.[0] || null;
}

const router = Router();

// POST /api/jobs/scan — Tam BIST taramasını tetikle
router.post("/scan", authenticate, async (req, res, next) => {
  try {
    await dispatchWorkflow("scan");
    res.status(202).json({
      status:  "triggered",
      message: "Tarama GitHub Actions üzerinde başlatıldı. /api/jobs/status ile takip edebilirsiniz.",
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/sync — Fiyat güncellemeyi tetikle
router.post("/sync", authenticate, async (req, res, next) => {
  try {
    await dispatchWorkflow("sync");
    res.status(202).json({
      status:  "triggered",
      message: "Fiyat güncelleme GitHub Actions üzerinde başlatıldı.",
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/status — En son çalışmanın durumunu getir
router.get("/status", authenticate, async (req, res, next) => {
  try {
    const run = await getLatestRun();
    if (!run) return res.json({ status: "none", message: "Henüz bir çalışma yok." });

    res.json({
      id:         run.id,
      status:     run.status,      // queued | in_progress | completed
      conclusion: run.conclusion,  // success | failure | null
      startedAt:  run.run_started_at,
      updatedAt:  run.updated_at,
      url:        run.html_url,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
