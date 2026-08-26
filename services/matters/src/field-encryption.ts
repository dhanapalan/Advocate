// Twin of src/lib/field-encryption.ts / supabase/functions/_shared/
// field-encryption.ts — same AES-256-GCM-via-Web-Crypto scheme, same "enc:"
// prefix convention, and the SAME FIELD_ENCRYPTION_KEY secret value as both
// — see wrangler.toml's comment for why (this service writes matters.notes,
// which the main app reads back and must be able to decrypt).
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
