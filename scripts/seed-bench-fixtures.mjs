#!/usr/bin/env node
/**
 * Deterministic fixture seed with real DOIs/sources.
 * Uses OpenAlex when available; falls back to curated metadata for famous papers.
 * Literature: fetch each survey by DOI (slow, polite).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const email =
  process.env.ARAITCHI_CONTACT_EMAIL?.trim() || "araitchi-bench@example.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oa(pathQuery, attempt = 0) {
  const url = `https://api.openalex.org${pathQuery}${pathQuery.includes("?") ? "&" : "?"}mailto=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": `AraitchiBench/0.1.1 (mailto:${email})` },
  });
  if (res.status === 429 && attempt < 8) {
    await sleep(3000 * (attempt + 1));
    return oa(pathQuery, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function normDoi(d) {
  if (!d) return null;
  return String(d)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase()
    .trim();
}

/** Famous papers with ground-truth metadata (OpenAlex-verified historically). */
const PAPERS = [
  {
    title: "Attention Is All You Need",
    doi: "10.48550/arxiv.1706.03762",
    year: 2017,
    author: "Ashish Vaswani",
    openalexId: "https://openalex.org/W2964202944",
  },
  {
    title:
      "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    doi: "10.48550/arxiv.1810.04805",
    year: 2018,
    author: "Jacob Devlin",
    openalexId: "https://openalex.org/W2897081623",
  },
  {
    title: "Deep Residual Learning for Image Recognition",
    doi: "10.1109/cvpr.2016.90",
    year: 2016,
    author: "Kaiming He",
    openalexId: "https://openalex.org/W2520845465",
  },
  {
    title: "Adam: A Method for Stochastic Optimization",
    doi: "10.48550/arxiv.1412.6980",
    year: 2014,
    author: "Diederik P. Kingma",
    openalexId: "https://openalex.org/W2144873047",
  },
  {
    title: "Generative Adversarial Nets",
    doi: "10.48550/arxiv.1406.2661",
    year: 2014,
    author: "Ian J. Goodfellow",
    openalexId: "https://openalex.org/W2102159465",
  },
  {
    title: "Dropout: a simple way to prevent neural networks from overfitting",
    doi: "10.5555/2627435.2670313",
    year: 2014,
    author: "Nitish Srivastava",
    openalexId: "https://openalex.org/W2138359843",
  },
  {
    title: "ImageNet Classification with Deep Convolutional Neural Networks",
    doi: "10.1145/3065386",
    year: 2017,
    author: "Alex Krizhevsky",
    openalexId: "https://openalex.org/W2108546565",
  },
  {
    title: "U-Net: Convolutional Networks for Biomedical Image Segmentation",
    doi: "10.1007/978-3-319-24574-4_28",
    year: 2015,
    author: "Olaf Ronneberger",
    openalexId: "https://openalex.org/W2151991443",
  },
  {
    title: "You Only Look Once: Unified, Real-Time Object Detection",
    doi: "10.1109/cvpr.2016.91",
    year: 2016,
    author: "Joseph Redmon",
    openalexId: "https://openalex.org/W2268860727",
  },
  {
    title:
      "Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift",
    doi: "10.48550/arxiv.1502.03167",
    year: 2015,
    author: "Sergey Ioffe",
    openalexId: "https://openalex.org/W1900047752",
  },
];

function buildVerifiable() {
  const items = [];
  for (const p of PAPERS) {
    const source = {
      doi: p.doi,
      title: p.title,
      openalexId: p.openalexId,
      url: `https://doi.org/${p.doi}`,
    };
    items.push({
      id: `ver-${items.length}`,
      question: `What is the DOI of the paper titled "${p.title}"?`,
      checker: "doi",
      expected: p.doi,
      source,
      taskType: "factual_lookup",
    });
    items.push({
      id: `ver-${items.length}`,
      question: `In what year was "${p.title}" first published?`,
      checker: "numeric",
      expected: p.year,
      tolerance: 0,
      source,
      taskType: "factual_lookup",
    });
    items.push({
      id: `ver-${items.length}`,
      question: `Who is listed as the first author of "${p.title}"?`,
      checker: "exact",
      expected: p.author,
      source,
      taskType: "factual_lookup",
    });
  }
  const closed = [
    [128, 64, "sum"],
    [512, 8, "div"],
    [7, 3, "pow"],
    [1000, 250, "diff"],
    [16, 16, "prod"],
    [81, 9, "div"],
    [2, 10, "pow"],
    [45, 17, "sum"],
    [99, 1, "diff"],
    [12, 12, "prod"],
  ];
  for (const [a, b, op] of closed) {
    let expected;
    let question;
    if (op === "sum") {
      expected = a + b;
      question = `Compute ${a} + ${b}.`;
    } else if (op === "diff") {
      expected = a - b;
      question = `Compute ${a} - ${b}.`;
    } else if (op === "prod") {
      expected = a * b;
      question = `Compute ${a} × ${b}.`;
    } else if (op === "div") {
      expected = a / b;
      question = `Compute ${a} ÷ ${b}.`;
    } else {
      expected = a ** b;
      question = `Compute ${a}^${b}.`;
    }
    items.push({
      id: `ver-${items.length}`,
      question,
      checker: "numeric",
      expected,
      tolerance: 1e-9,
      source: {
        url: "https://en.wikipedia.org/wiki/Arithmetic",
        title: "Closed-form arithmetic (harness-computed)",
      },
      taskType: "factual_lookup",
    });
  }
  return items.slice(0, 40).map((it, i) => ({ ...it, id: `ver-${i}` }));
}

async function resolveRefs(refIds) {
  const gold = [];
  for (let i = 0; i < refIds.length && gold.length < 30; i += 40) {
    const batch = refIds
      .slice(i, i + 40)
      .map((id) => String(id).replace("https://openalex.org/", ""));
    try {
      const page = await oa(
        `/works?filter=openalex_id:${batch.join("|")}&per_page=50`,
      );
      await sleep(1200);
      const scored = (page.results || [])
        .map((w) => ({
          id:
            normDoi(w.doi) ||
            (w.ids?.arxiv || "")
              .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
              .replace(/^arxiv:/i, "") ||
            null,
          cites: w.cited_by_count ?? 0,
        }))
        .filter((x) => x.id)
        .sort((a, b) => b.cites - a.cites);
      for (const x of scored) {
        if (!gold.includes(x.id)) gold.push(x.id);
        if (gold.length >= 30) break;
      }
    } catch (e) {
      console.warn("ref batch failed", e.message);
    }
  }
  return gold;
}

async function buildLiterature() {
  const existingPath = path.join(root, "evals/bench/literature/items.json");
  let items = [];
  if (existsSync(existingPath)) {
    items = JSON.parse(readFileSync(existingPath, "utf8")).filter(
      (x) =>
        x?.source?.openalexId &&
        Array.isArray(x.goldDois) &&
        x.goldDois.length >= 5,
    );
  }
  const used = new Set(items.map((x) => x.source.openalexId));

  // Search-based fill with long delays
  const topics = [
    "graph neural networks survey review",
    "federated learning survey",
    "self-supervised learning survey",
    "reinforcement learning deep survey",
    "diffusion models survey",
    "vision transformers survey",
    "knowledge distillation survey",
    "neural architecture search survey",
    "explainable artificial intelligence survey",
    "continual lifelong learning survey",
    "multimodal large language models survey",
    "prompt engineering survey",
    "retrieval augmented generation survey",
    "causal machine learning survey",
    "adversarial examples deep learning survey",
    "time series deep learning survey",
    "recommendation systems deep learning survey",
    "speech recognition deep learning survey",
    "meta learning survey",
    "domain adaptation survey",
    "active learning survey machine learning",
    "bayesian deep learning survey",
    "edge computing AI survey",
    "scientific machine learning survey",
    "code generation large language models survey",
  ];

  for (const topic of topics) {
    if (items.length >= 30) break;
    console.log(`lit ${items.length}/30 ← ${topic}`);
    try {
      const data = await oa(
        `/works?search=${encodeURIComponent(topic)}&filter=type:review|article,publication_year:2018-2025,has_references:true&sort=cited_by_count:desc&per_page=8`,
      );
      await sleep(1500);
      const work = (data.results || []).find(
        (w) =>
          (w.referenced_works_count ?? w.referenced_works?.length ?? 0) >= 60 &&
          !used.has(w.id),
      );
      if (!work) continue;
      const gold = await resolveRefs(work.referenced_works || []);
      if (gold.length < 5) continue;
      used.add(work.id);
      items.push({
        id: `lit-${items.length}`,
        question: `Find the key prior work on ${String(work.title || topic)
          .replace(/\b(a |an |the )?(survey|review)\b/gi, "")
          .trim()}. Do not cite the survey paper itself.`,
        goldDois: gold.slice(0, 30),
        yearTo: work.publication_year,
        taskType: "literature_review",
        source: {
          openalexId: work.id,
          doi: normDoi(work.doi),
          title: work.title,
          year: work.publication_year,
          url: work.doi || work.id,
        },
      });
      writeFileSync(existingPath, JSON.stringify(items, null, 2) + "\n");
    } catch (e) {
      console.warn(topic, e.message);
      await sleep(5000);
    }
  }

  return items.slice(0, 30).map((it, i) => ({ ...it, id: `lit-${i}` }));
}

async function main() {
  mkdirSync(path.join(root, "evals/bench/verifiable"), { recursive: true });
  mkdirSync(path.join(root, "evals/bench/literature"), { recursive: true });

  const verifiable = buildVerifiable();
  writeFileSync(
    path.join(root, "evals/bench/verifiable/items.json"),
    JSON.stringify(verifiable, null, 2) + "\n",
  );
  console.log("verifiable", verifiable.length);

  const literature = await buildLiterature();
  writeFileSync(
    path.join(root, "evals/bench/literature/items.json"),
    JSON.stringify(literature, null, 2) + "\n",
  );
  console.log("literature", literature.length);
  if (literature.length < 30) {
    console.warn(
      `WARNING: only ${literature.length}/30 literature items — re-run later to fill.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
