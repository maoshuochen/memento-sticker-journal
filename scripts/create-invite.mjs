import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const pepper = process.env.APP_SECRET;
if (!pepper || pepper.startsWith("replace_")) {
  throw new Error("Set APP_SECRET before generating an invite.");
}

const DATABASE_NAME = process.env.INVITE_DATABASE_NAME ?? "memento-journal";
const MAX_INVITES_PER_RUN = 50;

function usage() {
  console.log("Usage: npm run invite:create -- [--count 1] [--expires 7d] [--base-url https://journal.example] [--dry-run]");
}

function parseCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVITES_PER_RUN) {
    throw new Error(`--count must be an integer between 1 and ${MAX_INVITES_PER_RUN}.`);
  }
  return count;
}

function parseExpiry(value) {
  const match = /^(\d+)(h|d|w)$/i.exec(value);
  if (!match) throw new Error("--expires must use hours, days, or weeks, for example 24h, 7d, or 2w.");
  const amount = Number(match[1]);
  const multiplier = { h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 }[match[2].toLowerCase()];
  if (!Number.isSafeInteger(amount) || amount < 1 || amount * multiplier > Number.MAX_SAFE_INTEGER) {
    throw new Error("--expires is out of range.");
  }
  return amount * multiplier;
}

function parseOptions(args) {
  const options = { count: 1, expiresIn: undefined, baseUrl: process.env.APP_URL, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--count") options.count = parseCount(args[++index]);
    else if (argument === "--expires") options.expiresIn = parseExpiry(args[++index]);
    else if (argument === "--base-url") options.baseUrl = args[++index];
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") return null;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.baseUrl) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("--base-url must use HTTPS (or localhost for local testing).");
    options.baseUrl = url.toString();
  }
  return options;
}

function createInvite(pepper, createdAt, expiresAt) {
  const code = randomBytes(12).toString("base64url").toUpperCase();
  const hash = createHash("sha256").update(`${pepper}\0${code}`).digest("hex");
  return { id: randomUUID(), code, hash, createdAt, expiresAt };
}

function insertSql(invites) {
  const rows = invites.map(({ id, hash, createdAt, expiresAt }) => `('${id}', '${hash}', ${createdAt}, ${expiresAt ?? "NULL"})`).join(", ");
  return `INSERT INTO invite_codes (id, code_hash, created_at, expires_at) VALUES ${rows};`;
}

function registrationUrl(baseUrl, code) {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  url.searchParams.set("invite", code);
  return url.toString();
}

let options;
try {
  options = parseOptions(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not parse invite options.");
  usage();
  process.exit(1);
}

const createdAt = Date.now();
const expiresAt = options.expiresIn ? createdAt + options.expiresIn : null;
const invites = Array.from({ length: options.count }, () => createInvite(pepper, createdAt, expiresAt));
const sql = insertSql(invites);

if (options.dryRun) {
  console.log(sql);
  process.exit(0);
}

const result = spawnSync("npx", ["wrangler", "d1", "execute", DATABASE_NAME, "--remote", "--command", sql], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log("\nInvite(s) created:");
for (const invite of invites) {
  console.log(`- ${registrationUrl(options.baseUrl, invite.code) ?? invite.code}`);
}
if (!options.baseUrl) console.log("\nPass --base-url https://your-domain.example to print registration links instead of codes.");
