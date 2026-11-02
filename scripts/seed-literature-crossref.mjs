#!/usr/bin/env node
/** Build set-2 literature fixtures via Crossref (polite). */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "evals/bench/literature/items.json");
const email =
  process.env.ARAITCHI_CONTACT_EMAIL?.trim() || "araitchi-bench@example.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOPICS = [
  "graph neural networks survey",
  "transformer models survey NLP",
  "federated learning survey",
  "self-supervised learning survey",
  "reinforcement learning survey deep",
  "diffusion generative models survey",
  "vision transformers survey",
  "knowledge distillation survey",
  "neural architecture search survey",
  "explainable AI survey",
  "continual learning survey",
  "multimodal learning survey",
  "retrieval augmented generation survey",
  "causal inference machine learning survey",
  "adversarial robustness deep learning survey",
  "time series forecasting deep learning survey",
  "recommender systems deep learning survey",
  "speech recognition deep learning survey",
  "meta-learning few-shot survey",
  "domain adaptation survey deep learning",
  "active learning machine learning survey",
  "bayesian deep learning survey",
  "edge AI neural networks survey",
  "scientific machine learning survey",
  "code generation large language models survey",
  "prompt learning large language models survey",
  "contrastive learning survey",
  "object detection deep learning survey",
  "semantic segmentation deep learning survey",
  "anomaly detection deep learning survey",
];

async function cr(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": `AraitchiBench/0.1.1 (mailto:${email})` },
  });
  if (!res.ok) throw new Error(`Crossref ${res.status}`);
  return res.json();
}

function normDoi(d) {
  if (!d) return null;
  return String(d)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase()
    .trim();
}

function yearOf(item) {
  return (
    item.issued?.["date-parts"]?.[0]?.[0] ??
    item.published?.["date-parts"]?.[0]?.[0]
  );
}

async function main() {
  let items = [];
  if (existsSync(out)) {
    items = JSON.parse(readFileSync(out, "utf8")).filter(
      (x) => Array.isArray(x.goldDois) && x.goldDois.length >= 5 && x.source,
    );
  }
  const usedDois = new Set(
    items.map((x) => normDoi(x.source?.doi)).filter(Boolean),
  );
  const usedTitles = new Set(
    items.map((x) => String(x.source?.title || "").toLowerCase()),
  );

  for (const topic of TOPICS) {
    if (items.length >= 30) break;
    console.log(`${items.length}/30 ${topic}`);
    try {
      const data = await cr(
        `https://api.crossref.org/works?query=${encodeURIComponent(topic)}&filter=from-pub-date:2018,until-pub-date:2025&rows=15`,
      );
      await sleep(400);
      const candidates = (data.message?.items || []).filter((w) => {
        const title = (w.title?.[0] || "").toLowerCase();
        const refs = w["reference-count"] || w.reference?.length || 0;
        const doi = normDoi(w.DOI);
        const y = yearOf(w);
        if (!doi || !y || y < 2018 || y > 2025) return false;
        if (refs < 40) return false;
        if (usedDois.has(doi)) return false;
        if (usedTitles.has(title)) return false;
        if (!/survey|review|overview/i.test(title)) return false;
        return true;
      });
      const pick = candidates[0];
      if (!pick) continue;

      // Prefer works with embedded references
      let gold = (pick.reference || [])
        .map((r) => normDoi(r.DOI))
        .filter(Boolean);
      if (gold.length < 5) {
        // Fetch full work
        const full = await cr(
          `https://api.crossref.org/works/${encodeURIComponent(pick.DOI)}`,
        );
        await sleep(300);
        gold = (full.message?.reference || [])
          .map((r) => normDoi(r.DOI))
          .filter(Boolean);
      }
      // Unique, cap 30
      gold = [...new Set(gold)].slice(0, 30);
      if (gold.length < 5) continue;

      const title = pick.title?.[0] || topic;
      const doi = normDoi(pick.DOI);
      const y = yearOf(pick);
      usedDois.add(doi);
      usedTitles.add(title.toLowerCase());
      items.push({
        id: `lit-${items.length}`,
        question: `Find the key prior work on ${title
          .replace(/\b(a |an |the )?(survey|review|overview)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()}. Do not cite the survey paper itself.`,
        goldDois: gold,
        yearTo: y,
        taskType: "literature_review",
        source: {
          doi,
          title,
          year: y,
          url: `https://doi.org/${doi}`,
        },
      });
      writeFileSync(out, JSON.stringify(items, null, 2) + "\n");
    } catch (e) {
      console.warn(topic, e.message);
      await sleep(2000);
    }
  }

  items = items.slice(0, 30).map((it, i) => ({ ...it, id: `lit-${i}` }));
  writeFileSync(out, JSON.stringify(items, null, 2) + "\n");
  console.log("Wrote", items.length, "literature items");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
