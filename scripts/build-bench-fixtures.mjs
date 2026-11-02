#!/usr/bin/env node
/**
 * Build real bench fixtures from OpenAlex (network). Run once; commit output.
 * Retries on 429 with backoff. Never invents gold answers.
 *
 *   node scripts/build-bench-fixtures.mjs [--only verifiable|literature]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const email =
  process.env.ARAITCHI_CONTACT_EMAIL?.trim() || "araitchi@example.com";
const only = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeDoi(d) {
  if (!d) return null;
  return String(d)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase()
    .trim();
}

async function oa(urlPath, attempt = 0) {
  const sep = urlPath.includes("?") ? "&" : "?";
  const url = urlPath.startsWith("http")
    ? urlPath
    : `https://api.openalex.org${urlPath}${sep}mailto=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": `AraitchiBench/0.1.1 (mailto:${email})` },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 8) {
    const wait = Math.min(30_000, 1500 * 2 ** attempt);
    console.warn(`${res.status} — backoff ${wait}ms (attempt ${attempt + 1})`);
    await sleep(wait);
    return oa(urlPath, attempt + 1);
  }
  if (!res.ok) throw new Error(`OpenAlex ${res.status} ${url}`);
  return res.json();
}

/** Curated survey DOIs / titles in AI & engineering (2018–2025). */
const SURVEY_SEEDS = [
  "10.1109/access.2020.2983149", // CNN survey
  "10.1109/tnnls.2020.2978386", // GNN survey
  "10.1561/2200000071", // deep RL survey
  "10.1561/2200000083", // self-supervised
  "10.1109/tpami.2021.3055564", // NAS survey-ish
  "10.1145/3397512", // knowledge distillation
  "10.1561/2200000082", // continual learning?
  "10.1109/tkde.2021.3090866",
  "10.1145/3505244", // XAI
  "10.1109/jas.2021.1004129",
  "10.1145/3505245",
  "10.1561/2200000091",
  "10.1109/comst.2021.3063661",
  "10.1145/3522745",
  "10.1109/access.2021.3086020",
  "10.1145/3560815", // LLM survey-ish
  "10.1109/tpami.2022.3152247",
  "10.1145/3582688",
  "10.1561/2200000095",
  "10.1109/comst.2022.3202237",
  "10.1145/3603703",
  "10.1109/access.2022.3200054",
  "10.1145/3634420",
  "10.1109/tkde.2023.3283662",
  "10.1145/3641289",
  "10.1109/tpami.2023.3262783",
  "10.1145/3657283",
  "10.1109/access.2023.3302754",
  "10.1145/3672110",
  "10.1109/comst.2024.3362254",
  // Title searches as fallback seeds (used if DOI miss)
  'title.search:"survey of transformers"',
  'title.search:"survey of graph neural"',
  'title.search:"survey of federated learning"',
  'title.search:"survey of multimodal"',
  'title.search:"survey of diffusion models"',
  'title.search:"survey of large language models"',
  'title.search:"survey of reinforcement learning"',
  'title.search:"survey of adversarial"',
  'title.search:"survey of recommender"',
  'title.search:"survey of speech recognition"',
  'title.search:"survey of domain adaptation"',
  'title.search:"survey of meta-learning"',
  'title.search:"survey of neural architecture search"',
  'title.search:"survey of knowledge distillation"',
  'title.search:"survey of explainable"',
];

const CS_CONCEPT = "C41008148"; // Computer science

function paraphraseTopic(title, abstract) {
  const base = String(title || "")
    .replace(/\b(a |an |the )?survey\b/gi, "")
    .replace(/\breview\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const hint = String(abstract || "")
    .slice(0, 160)
    .replace(/\s+/g, " ");
  return `Find the key prior work on ${base || "this research area"}${hint ? ` (context: ${hint}…)` : ""}. Do not cite the survey paper itself.`;
}

function invertAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  return Object.entries(inv)
    .flatMap(([word, pos]) =>
      Array.isArray(pos) ? pos.map((p) => ({ word, p })) : [],
    )
    .sort((a, b) => a.p - b.p)
    .map((x) => x.word)
    .join(" ");
}

async function fetchWorkByDoi(doi) {
  const data = await oa(`/works/doi:${encodeURIComponent(doi)}`);
  return data;
}

async function fetchWorkByFilter(filter) {
  const data = await oa(
    `/works?filter=${filter},type:review|article,publication_year:2018-2025,concepts.id:${CS_CONCEPT}&sort=cited_by_count:desc&per_page=3`,
  );
  return (data.results || []).find(
    (w) => (w.referenced_works_count ?? w.referenced_works?.length ?? 0) >= 60,
  );
}

async function resolveRefs(refIds) {
  const gold = [];
  for (let j = 0; j < refIds.length && gold.length < 30; j += 40) {
    const batch = refIds.slice(j, j + 40);
    const ids = batch
      .map((id) => String(id).replace("https://openalex.org/", ""))
      .join("|");
    if (!ids) continue;
    try {
      const page = await oa(`/works?filter=openalex_id:${ids}&per_page=50`);
      await sleep(700);
      const scored = (page.results || [])
        .map((w) => ({
          doi: normalizeDoi(w.doi),
          arxiv: (w.ids?.arxiv || "")
            .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
            .replace(/^arxiv:/i, ""),
          cites: w.cited_by_count ?? 0,
        }))
        .filter((x) => x.doi || x.arxiv)
        .sort((a, b) => b.cites - a.cites);
      for (const x of scored) {
        const id = x.doi || x.arxiv;
        if (id && !gold.includes(id)) gold.push(id);
        if (gold.length >= 30) break;
      }
    } catch (e) {
      console.warn("ref batch failed", e.message);
    }
  }
  return gold;
}

async function buildLiterature() {
  const outFile = path.join(root, "evals/bench/literature/items.json");
  const existing = existsSync(outFile)
    ? JSON.parse(readFileSync(outFile, "utf8"))
    : [];
  const items = existing.filter(
    (x) =>
      x?.source?.openalexId &&
      Array.isArray(x.goldDois) &&
      x.goldDois.length >= 5 &&
      // Drop obvious non-CS leftovers from earlier bad search
      !/prisma|who classification|microbiota|nia.?aa|conservation/i.test(
        String(x.source?.title ?? ""),
      ),
  );
  const used = new Set(items.map((x) => x.source.openalexId));
  console.log(`Literature resume: ${items.length} kept`);

  for (const seed of SURVEY_SEEDS) {
    if (items.length >= 30) break;
    console.log(`Literature ${items.length + 1}/30 seed=${seed}`);
    try {
      let work = null;
      if (seed.startsWith("10.")) {
        try {
          work = await fetchWorkByDoi(seed);
        } catch {
          work = null;
        }
      } else {
        work = await fetchWorkByFilter(seed);
      }
      await sleep(900);
      if (!work?.id) continue;
      if (used.has(work.id)) continue;
      const refCount =
        work.referenced_works_count ?? work.referenced_works?.length ?? 0;
      if (refCount < 40) continue;
      const year = work.publication_year;
      if (!year || year < 2018 || year > 2025) continue;
      const gold = await resolveRefs(
        (work.referenced_works || []).slice(0, 100),
      );
      if (gold.length < 5) {
        console.warn("too few gold ids", work.title);
        continue;
      }
      used.add(work.id);
      items.push({
        id: `lit-${items.length}`,
        question: paraphraseTopic(
          work.title,
          invertAbstract(work.abstract_inverted_index),
        ),
        goldDois: gold.slice(0, 30),
        yearTo: year,
        taskType: "literature_review",
        source: {
          openalexId: work.id,
          doi: normalizeDoi(work.doi),
          title: work.title,
          year,
          url: work.doi || work.id,
        },
      });
      // checkpoint
      writeFileSync(outFile, JSON.stringify(items, null, 2) + "\n");
    } catch (e) {
      console.warn("skip", seed, e.message);
      await sleep(2000);
    }
  }
  // re-id sequentially
  const final = items.slice(0, 30).map((x, i) => ({ ...x, id: `lit-${i}` }));
  return final;
}

const PAPER_QUERIES = [
  "Attention Is All You Need Vaswani",
  "BERT Pre-training of Deep Bidirectional Transformers",
  "Deep Residual Learning for Image Recognition He",
  "Adam A Method for Stochastic Optimization Kingma",
  "Generative Adversarial Nets Goodfellow",
  "Dropout Srivastava neural networks overfitting",
  "ImageNet classification Krizhevsky",
  "U-Net Ronneberger Biomedical",
  "You Only Look Once Redmon",
  "Batch Normalization Ioffe Szegedy",
  "Neural Machine Translation Bahdanau",
  "Word2Vec Mikolov Efficient Estimation",
  "GloVe Pennington",
  "XGBoost Chen Guestrin",
];

async function buildVerifiable() {
  const items = [];
  for (const q of PAPER_QUERIES) {
    if (items.length >= 32) break;
    try {
      const data = await oa(
        `/works?search=${encodeURIComponent(q)}&sort=cited_by_count:desc&per_page=1`,
      );
      await sleep(800);
      const w = data.results?.[0];
      if (!w) continue;
      const doi = normalizeDoi(w.doi);
      const year = w.publication_year;
      const author = w.authorships?.[0]?.author?.display_name;
      const title = w.title;
      const source = {
        openalexId: w.id,
        doi,
        title,
        url: w.doi || w.id,
      };
      if (doi) {
        items.push({
          id: `ver-${items.length}`,
          question: `What is the DOI of the paper titled "${title}"?`,
          checker: "doi",
          expected: doi,
          source,
          taskType: "factual_lookup",
        });
      }
      if (year) {
        items.push({
          id: `ver-${items.length}`,
          question: `In what calendar year was "${title}" first published?`,
          checker: "numeric",
          expected: year,
          tolerance: 0,
          source,
          taskType: "factual_lookup",
        });
      }
      if (author) {
        items.push({
          id: `ver-${items.length}`,
          question: `Who is the first author of "${title}"?`,
          checker: "exact",
          expected: author,
          source,
          taskType: "factual_lookup",
        });
      }
    } catch (e) {
      console.warn(q, e.message);
      await sleep(2000);
    }
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
    [3, 5, "pow"],
    [777, 7, "div"],
    [250, 250, "sum"],
    [64, 4, "div"],
    [11, 11, "prod"],
  ];
  for (const [a, b, op] of closed) {
    if (items.length >= 40) break;
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
        title: "Closed-form arithmetic (harness-computed expected)",
      },
      taskType: "factual_lookup",
    });
  }
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = it.question.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push({ ...it, id: `ver-${unique.length}` });
    if (unique.length >= 40) break;
  }
  return unique;
}

async function main() {
  mkdirSync(path.join(root, "evals/bench/verifiable"), { recursive: true });
  mkdirSync(path.join(root, "evals/bench/literature"), { recursive: true });

  let verifiable;
  let literature;

  if (!only || only === "verifiable") {
    console.log("Building verifiable…");
    verifiable = await buildVerifiable();
    writeFileSync(
      path.join(root, "evals/bench/verifiable/items.json"),
      JSON.stringify(verifiable, null, 2) + "\n",
    );
    console.log(`Wrote ${verifiable.length} verifiable`);
  } else {
    verifiable = JSON.parse(
      readFileSync(
        path.join(root, "evals/bench/verifiable/items.json"),
        "utf8",
      ),
    );
  }

  if (!only || only === "literature") {
    console.log("Building literature…");
    literature = await buildLiterature();
    writeFileSync(
      path.join(root, "evals/bench/literature/items.json"),
      JSON.stringify(literature, null, 2) + "\n",
    );
    console.log(`Wrote ${literature.length} literature`);
  } else {
    literature = JSON.parse(
      readFileSync(
        path.join(root, "evals/bench/literature/items.json"),
        "utf8",
      ),
    );
  }

  const meta = {
    builtAt: new Date().toISOString(),
    verifiable: verifiable.length,
    literature: literature.length,
    hash: createHash("sha256")
      .update(JSON.stringify({ v: verifiable.length, l: literature.length }))
      .digest("hex")
      .slice(0, 16),
  };
  writeFileSync(
    path.join(root, "evals/bench/BUILD_META.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );
  console.log("Done", meta);
  if (verifiable.length < 40 || literature.length < 30) {
    console.error(
      `Incomplete fixtures: verifiable=${verifiable.length}/40 literature=${literature.length}/30 — re-run with backoff`,
    );
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
