import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getAppDb } from "./db/client";
import { secrets } from "./db/schema";
import { getAppDataDir } from "./paths";

export const SECRET_NAMES = [
  "openrouter_api_key",
  "semantic_scholar_api_key",
  "core_api_key",
  "github_token",
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function isAllowedName(name: string): name is SecretName {
  return (SECRET_NAMES as readonly string[]).includes(name);
}

function assertAllowedName(name: string): asserts name is SecretName {
  if (!isAllowedName(name)) {
    throw new Error(`Secret name is not allowed: ${name}`);
  }
}

function getMasterKeyPath(): string {
  return path.join(getAppDataDir(), "master.key");
}

function loadOrCreateMasterKey(): Buffer {
  const keyPath = getMasterKeyPath();
  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }

  const dir = path.dirname(keyPath);
  mkdirSync(dir, { recursive: true });
  const key = randomBytes(32);
  try {
    writeFileSync(keyPath, key, { mode: 0o600 });
  } catch {
    writeFileSync(keyPath, key);
  }
  return key;
}

function encrypt(plaintext: string): {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  const key = loadOrCreateMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt(ciphertext: string, iv: string, tag: string): string {
  const key = loadOrCreateMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function setSecret(name: string, value: string): void {
  assertAllowedName(name);
  const { ciphertext, iv, tag } = encrypt(value);
  const now = Date.now();

  getAppDb()
    .insert(secrets)
    .values({ name, ciphertext, iv, tag, updatedAt: now })
    .onConflictDoUpdate({
      target: secrets.name,
      set: { ciphertext, iv, tag, updatedAt: now },
    })
    .run();
}

export function getSecret(name: string): string | null {
  assertAllowedName(name);
  const row = getAppDb()
    .select()
    .from(secrets)
    .where(eq(secrets.name, name))
    .get();

  if (!row) {
    return null;
  }

  return decrypt(row.ciphertext, row.iv, row.tag);
}

export function hasSecret(name: string): boolean {
  assertAllowedName(name);
  const row = getAppDb()
    .select({ name: secrets.name })
    .from(secrets)
    .where(eq(secrets.name, name))
    .get();
  return Boolean(row);
}

export function deleteSecret(name: string): boolean {
  assertAllowedName(name);
  const result = getAppDb().delete(secrets).where(eq(secrets.name, name)).run();
  return result.changes > 0;
}

export function listSecretNames(): SecretName[] {
  const rows = getAppDb().select({ name: secrets.name }).from(secrets).all();
  return rows
    .map((row) => row.name)
    .filter((name): name is SecretName => isAllowedName(name));
}

/** Expose ciphertext for tests only — never use in API responses. */
export function getSecretCiphertextForTests(name: string): string | null {
  assertAllowedName(name);
  const row = getAppDb()
    .select({ ciphertext: secrets.ciphertext })
    .from(secrets)
    .where(eq(secrets.name, name))
    .get();
  return row?.ciphertext ?? null;
}
