// Deno copy of src/lib/field-encryption.ts — same algorithm, same "enc:"
// prefix format, same FIELD_ENCRYPTION_KEY secret (set separately here via
// `supabase secrets set`, since Edge Functions and the Cloudflare Worker
// don't share a secret store). Only ai-generate-draft (ai_drafts.content)
// and ai-analyze-document (ai_documents.raw_text) write these columns
// directly from Deno; every read site is on the Cloudflare Worker side.
// Port fixes to both copies — same reasoning as this codebase's other
// intentionally-duplicated shared file, supabase/functions/_shared/
// (doc-extract's extract.mjs).
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
  const b64 = Deno.env.get("FIELD_ENCRYPTION_KEY");
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
