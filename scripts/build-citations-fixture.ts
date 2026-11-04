/**
 * Build evals/citations/fixture.json with ≥200 cases:
 * ≥60 fake, ≥40 mismatch, ≥40 contradicted (support), ≥60 real (LitSearch/survey gold).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Paper } from "../src/lib/server/tools/papers/types";

type Case = {
  id: string;
  text: string;
  expectedStatus:
    "not_found" | "metadata_mismatch" | "claim_not_supported" | "verified";
  kind: "fake" | "mismatch" | "support" | "real";
  resolve?: {
    doi?: string;
    arxivId?: string;
    paper: Paper;
  };
  support?: "supported" | "not_supported" | "unclear";
};

const KNOWN: {
  doi: string;
  arxivId?: string;
  title: string;
  authors: string[];
  year: number;
  abstract: string;
  supportedClaim: string;
  contradictedClaim: string;
}[] = [
  {
    doi: "10.5555/3295222.3295349",
    arxivId: "1706.03762",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer"],
    year: 2017,
    abstract:
      "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
    supportedClaim: "uses self-attention instead of recurrence",
    contradictedClaim:
      "proves that recurrent neural networks are the only architecture that can translate languages",
  },
  {
    doi: "10.48550/arxiv.1810.04805",
    arxivId: "1810.04805",
    title:
      "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    authors: ["Jacob Devlin", "Ming-Wei Chang"],
    year: 2019,
    abstract:
      "We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. BERT is designed to pre-train deep bidirectional representations.",
    supportedClaim: "introduces bidirectional transformer pre-training",
    contradictedClaim:
      "shows that bag-of-words models outperform all transformer architectures on GLUE",
  },
  {
    doi: "10.48550/arxiv.1409.1556",
    arxivId: "1409.1556",
    title: "Very Deep Convolutional Networks for Large-Scale Image Recognition",
    authors: ["Karen Simonyan", "Andrew Zisserman"],
    year: 2015,
    abstract:
      "In this work we investigate the effect of the convolutional network depth on its accuracy in the large-scale image recognition setting. We use an architecture with very small convolution filters.",
    supportedClaim: "studies how CNN depth affects image recognition accuracy",
    contradictedClaim:
      "concludes that one-layer perceptrons beat deep CNNs on ImageNet",
  },
  {
    doi: "10.48550/arxiv.1512.03385",
    arxivId: "1512.03385",
    title: "Deep Residual Learning for Image Recognition",
    authors: ["Kaiming He", "Xiangyu Zhang"],
    year: 2016,
    abstract:
      "We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. We explicitly reformulate the layers as learning residual functions.",
    supportedClaim: "introduces residual learning for deeper networks",
    contradictedClaim:
      "argues that residual connections make networks impossible to train",
  },
  {
    doi: "10.48550/arxiv.1412.6980",
    arxivId: "1412.6980",
    title: "Adam: A Method for Stochastic Optimization",
    authors: ["Diederik P. Kingma", "Jimmy Ba"],
    year: 2015,
    abstract:
      "We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions, based on adaptive estimates of lower-order moments.",
    supportedClaim: "proposes an adaptive moment estimation optimizer",
    contradictedClaim:
      "proves that SGD without momentum is always superior to adaptive methods",
  },
  {
    doi: "10.1109/cvpr.2016.90",
    title: "Deep Residual Learning for Image Recognition",
    authors: ["Kaiming He"],
    year: 2016,
    abstract:
      "Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper.",
    supportedClaim: "presents residual learning for deep image recognition",
    contradictedClaim:
      "shows that residual networks cannot classify natural images",
  },
  {
    doi: "10.48550/arxiv.1706.03762",
    arxivId: "1706.03762",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani"],
    year: 2017,
    abstract:
      "The Transformer architecture relies entirely on self-attention to compute representations, without recurrence or convolutions.",
    supportedClaim: "relies on self-attention without recurrence",
    contradictedClaim:
      "demonstrates that convolution is strictly necessary for sequence transduction",
  },
  {
    doi: "10.1162/neco.1997.9.8.1735",
    title: "Long Short-Term Memory",
    authors: ["Sepp Hochreiter", "Jurgen Schmidhuber"],
    year: 1997,
    abstract:
      "We introduce Long Short-Term Memory (LSTM), a novel recurrent network architecture that can learn long-range dependencies by using memory cells and gates.",
    supportedClaim: "introduces LSTM memory cells for long-range dependencies",
    contradictedClaim:
      "claims feed-forward networks alone solve all sequence tasks without recurrence",
  },
];

const FAKE_TITLES = [
  "Hyperbolic Unicorn Embeddings for Multiverse Retrieval",
  "A Comprehensive Survey of Invisible Gradient Alchemy",
  "Quantum Bagels as Universal Function Approximators",
  "Neural Telepathy via Ambient WiFi Phase Noise",
  "On the Impossibility of Learning Without Coffee",
  "Recursive Dreams of Electric Sheep Classifiers",
  "Latent Spaces of Mythical Creatures",
  "Differential Privacy for Gossip Protocols in Atlantis",
  "Self-Supervised Astrology for Tabular Data",
  "Transformerless Attention via Candlelight",
];

const WRONG_TITLES = [
  "A Paper About Unicorns in Gradient Descent",
  "Cooking Pasta with Stochastic Gradients",
  "The Complete Guide to Imaginary Numbers in Biology",
  "Why Cats Invented Backpropagation",
  "Underwater Basket Weaving with Neural ODEs",
  "Telepathic Batch Normalization Explained",
  "A Taxonomy of Fictional Optimizers",
  "Moon Cheese Classification with GNNs",
];

function paperOf(
  k: (typeof KNOWN)[number],
  foundBy: Paper["foundBy"] = ["crossref"],
): Paper {
  return {
    title: k.title,
    authors: k.authors,
    year: k.year,
    venue: null,
    abstract: k.abstract,
    doi: k.doi,
    arxivId: k.arxivId ?? null,
    url: `https://doi.org/${k.doi}`,
    pdfUrl: null,
    citationCount: 100,
    foundBy,
  };
}

function syntheticPaper(doi: string, i: number): Paper {
  const author = `Author${(i % 26) + 1}`;
  const year = 2000 + (i % 24);
  return {
    title: `Gold literature paper ${i}: foundations of method ${i}`,
    authors: [`${author} Surname`],
    year,
    venue: "Survey Proceedings",
    abstract: `This paper studies method ${i} and reports empirical results on standard benchmarks. We find that technique ${i} improves accuracy under controlled conditions.`,
    doi,
    arxivId: doi.toLowerCase().includes("arxiv.")
      ? (doi.split("arxiv.")[1] ?? null)
      : null,
    url: `https://doi.org/${doi}`,
    pdfUrl: null,
    citationCount: 10 + i,
    foundBy: ["crossref"],
  };
}

function main() {
  const root = process.cwd();
  const lit = JSON.parse(
    readFileSync(path.join(root, "evals/bench/literature/items.json"), "utf8"),
  ) as { goldDois?: string[] }[];
  const goldDois = [
    ...new Set(lit.flatMap((x) => x.goldDois ?? []).filter(Boolean)),
  ];
  if (goldDois.length < 60) {
    throw new Error(`Need ≥60 gold DOIs, got ${goldDois.length}`);
  }

  const cases: Case[] = [];

  // ≥60 fake
  for (let i = 0; i < 60; i++) {
    const useArxiv = i % 3 === 0;
    if (useArxiv) {
      const id = `${9000 + i}.${10000 + i}`;
      cases.push({
        id: `fake-arxiv-${i}`,
        text: `According to arxiv:${id}, ${FAKE_TITLES[i % FAKE_TITLES.length]} revolutionizes science.`,
        expectedStatus: "not_found",
        kind: "fake",
      });
    } else {
      const doi = `10.9999/fake.eval.${String(i).padStart(3, "0")}.${2000 + i}`;
      cases.push({
        id: `fake-doi-${i}`,
        text: `Smith et al. show in doi:${doi} that ${FAKE_TITLES[i % FAKE_TITLES.length].toLowerCase()}.`,
        expectedStatus: "not_found",
        kind: "fake",
      });
    }
  }

  // ≥40 metadata mismatches — Crossref-resolvable DOIs (keyless offline).
  // Lead with doi: so free-text extraction does not sort first.
  const CROSSREF_MISMATCH: {
    doi: string;
    title: string;
    authors: string[];
    year: number;
    abstract: string;
  }[] = [
    {
      doi: "10.1109/cvpr.2016.90",
      title: "Deep Residual Learning for Image Recognition",
      authors: ["Kaiming He"],
      year: 2016,
      abstract: "We present a residual learning framework for deeper networks.",
    },
    {
      doi: "10.1162/neco.1997.9.8.1735",
      title: "Long Short-Term Memory",
      authors: ["Sepp Hochreiter", "Jurgen Schmidhuber"],
      year: 1997,
      abstract:
        "We introduce LSTM, a recurrent architecture for long-range dependencies.",
    },
    {
      doi: "10.1038/323533a0",
      title: "Learning representations by back-propagating errors",
      authors: ["David E. Rumelhart"],
      year: 1986,
      abstract:
        "We describe a new learning procedure, back-propagation, for networks.",
    },
    {
      doi: "10.1109/5.726791",
      title: "Gradient-based learning applied to document recognition",
      authors: ["Y. Lecun"],
      year: 1998,
      abstract:
        "Multilayer neural networks trained with gradient descent for document recognition.",
    },
    {
      doi: "10.1109/tpami.2016.2577031",
      title:
        "Faster R-CNN: Towards Real-Time Object Detection with Region Proposal Networks",
      authors: ["Shaoqing Ren"],
      year: 2017,
      abstract: "We present Faster R-CNN with a region proposal network.",
    },
    {
      doi: "10.3115/v1/d14-1181",
      title: "Convolutional Neural Networks for Sentence Classification",
      authors: ["Yoon Kim"],
      year: 2014,
      abstract: "We report on CNN models for sentence classification tasks.",
    },
    {
      doi: "10.1007/s11263-009-0275-4",
      title: "The Pascal Visual Object Classes (VOC) Challenge",
      authors: ["Mark Everingham"],
      year: 2009,
      abstract: "The Pascal VOC challenge for visual object class recognition.",
    },
    {
      doi: "10.1113/jphysiol.1962.sp006837",
      title:
        "Receptive fields, binocular interaction and functional architecture in the cat's visual cortex",
      authors: ["D. H. Hubel"],
      year: 1962,
      abstract: "We describe receptive fields in the cat visual cortex.",
    },
  ];
  for (let i = 0; i < 40; i++) {
    const k = CROSSREF_MISMATCH[i % CROSSREF_MISMATCH.length]!;
    const wrong = WRONG_TITLES[i % WRONG_TITLES.length]!;
    const wrongYear = 1990 + (i % 10);
    const wrongAuthor = "Totallyfake";
    const paper: Paper = {
      title: k.title,
      authors: k.authors,
      year: k.year,
      venue: null,
      abstract: k.abstract,
      doi: k.doi,
      arxivId: null,
      url: `https://doi.org/${k.doi}`,
      pdfUrl: null,
      citationCount: 100,
      foundBy: ["crossref"],
    };
    cases.push({
      id: `mismatch-${i}`,
      text: `According to doi:${k.doi} (${wrongAuthor}, ${wrongYear}, "${wrong}") the result is mythical.`,
      expectedStatus: "metadata_mismatch",
      kind: "mismatch",
      resolve: { doi: k.doi, paper },
    });
  }

  // ≥40 contradicted claims
  for (let i = 0; i < 40; i++) {
    const k = KNOWN[i % KNOWN.length]!;
    const idPart = k.arxivId ? `arxiv:${k.arxivId}` : `doi:${k.doi}`;
    cases.push({
      id: `support-${i}`,
      text: `${idPart} ${k.contradictedClaim}.`,
      expectedStatus: "claim_not_supported",
      kind: "support",
      resolve: { doi: k.doi, arxivId: k.arxivId, paper: paperOf(k, ["arxiv"]) },
      support: "not_supported",
    });
  }

  // ≥150 correct real citations from LitSearch/survey gold (live FP needs n≥150)
  const REAL_N = 150;
  for (let i = 0; i < REAL_N; i++) {
    if (i < KNOWN.length) {
      const known = KNOWN[i]!;
      const idPart = known.arxivId
        ? `arxiv:${known.arxivId}`
        : `doi:${known.doi}`;
      cases.push({
        id: `real-known-${i}`,
        text: `The work (${idPart}) ${known.supportedClaim}.`,
        expectedStatus: "verified",
        kind: "real",
        resolve: {
          doi: known.doi,
          arxivId: known.arxivId,
          paper: paperOf(known),
        },
        support: "supported",
      });
    } else {
      const doi = goldDois[i % goldDois.length]!;
      const paper = syntheticPaper(doi, i);
      // Bare DOI cite — live resolve checks existence; planted title is fixture-only.
      cases.push({
        id: `real-gold-${i}`,
        text: `According to doi:${doi} the cited prior work is relevant to this question.`,
        expectedStatus: "verified",
        kind: "real",
        resolve: { doi, paper },
        support: "supported",
      });
    }
  }

  const counts = {
    fake: cases.filter((c) => c.kind === "fake").length,
    mismatch: cases.filter((c) => c.kind === "mismatch").length,
    support: cases.filter((c) => c.kind === "support").length,
    real: cases.filter((c) => c.kind === "real").length,
  };
  if (
    counts.fake < 60 ||
    counts.mismatch < 40 ||
    counts.support < 40 ||
    counts.real < 150 ||
    cases.length < 290
  ) {
    throw new Error(
      `Fixture too small: ${JSON.stringify(counts)} total=${cases.length}`,
    );
  }

  const outDir = path.join(root, "evals/citations");
  mkdirSync(outDir, { recursive: true });
  const payload = {
    meta: {
      builtAt: new Date().toISOString(),
      counts,
      sources: ["evals/bench/literature/items.json", "known landmark papers"],
    },
    cases,
  };
  writeFileSync(
    path.join(outDir, "fixture.json"),
    JSON.stringify(payload, null, 2) + "\n",
  );
  console.log(
    `Wrote ${cases.length} cases → evals/citations/fixture.json`,
    counts,
  );
}

main();
