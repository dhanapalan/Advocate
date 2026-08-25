// Column-level encryption for the free-text fields that hold real privileged
// content: matters.notes, clients.notes, hearings.purpose, ai_documents.
// raw_text, ai_drafts.content. RLS already stops one tenant reading another's
// rows (live-tested) — this is a second, independent layer for a different
// threat: someone with raw database access (a stolen backup, a compromised
// service-role key) sees ciphertext, not plaintext. Deliberately NOT applied
// to searchable fields (matters.title/client_name/case_number, clients.name/
// phone/email) — the header search box does ILIKE against those directly,
// which can't work on ciphertext, and search was judged more valuable than
// encrypting fields that are already isolated by RLS and aren't free-text
// case content.
//
// AES-256-GCM via Web Crypto (available natively on Cloudflare Workers — no
// Node crypto dependency). Ciphertext is base64(iv || ciphertext+tag),
// prefixed "enc:" so a column's existing plaintext rows (written before this
// shipped) keep reading back correctly — decryptField() only decrypts values
// carrying the prefix, everything else passes through unchanged. Columns
// stay plain TEXT; no schema change.
//
// The key (FIELD_ENCRYPTION_KEY, a base64-encoded 32-byte value) lives only
// as a Cloudflare Worker secret — never in the database, never sent to the
// browser. supabase/functions/_shared/field-encryption.ts is the same logic
// for the two edge functions (ai-generate-draft, ai-analyze-document) that
// write these columns directly from Deno; port fixes to both, same as this
// codebase already does for doc-extract's two copies.
const ALGO = "AES-GCM";
const IV_LENGTH = 12;
const PREFIX = "enc:";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const b64 = process.env["FIELD_ENCRYPTION_KEY"];
  if (!b64) throw new Error("FIELD_ENCRYPTION_KEY is not configured.");
  const raw = base64ToBytes(b64);
  return crypto.subtle.importKey("raw", raw, ALGO, false, ["encrypt", "decrypt"]);
}

export async function encryptField(plaintext: string | null | undefined): Promise<string | null> {
  if (plaintext == null || plaintext === "") return null;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return PREFIX + bytesToBase64(combined);
}

export async function decryptField(stored: string | null | undefined): Promise<string | null> {
  if (stored == null || stored === "") return null;
  if (!stored.startsWith(PREFIX)) return stored; // pre-existing plaintext row
  const key = await getKey();
  const combined = base64ToBytes(stored.slice(PREFIX.length));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const plaintextBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBuf);
}
