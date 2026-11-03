export const BRIEF_TEMPLATE = `# Research brief

## Goal


## Constraints


## Key definitions


## Out of scope

`;

export const STATE_TEMPLATE = `# Project state

## Goal

_Describe the research goal (from brief or edit here)._

## Current status

_User-owned narrative. System proposals appear below for acceptance._

## Active hypotheses

_Generated from notebook._

## Key decisions

_Generated from notebook._

## Already tested

_Generated from notebook / experiments._

## Open questions

_Generated from notebook._

## Next steps

_User-owned narrative. System proposals appear below for acceptance._
`;

export const PROJECT_AGENTS_TEMPLATE = `# Project instructions

Domain, methods, rigor standards, citation style, terminology, and things to avoid for this research project.

## Domain


## Methods


## Rigor standards


## Citation style


## Terminology


## Things to avoid

`;

export const RESEARCHIGNORE_TEMPLATE = `# Paths that must never reach a model (glob patterns, like .gitignore).
# Secrets denylist and .gitignore are also respected.
*.pem
*.key
.env
.env.*
**/secrets/**
**/credentials/**
`;

export const RESEARCH_GITIGNORE = `notebook.db-wal
notebook.db-shm
.lock
cache/
backups/*.zip
`;
