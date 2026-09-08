/**
 * Length-independent string comparison for shared secrets.
 *
 * `a === b` on a secret leaks, in principle, how many leading characters were
 * right — the comparison stops at the first mismatch. Over the public internet
 * that signal is buried in jitter and this is not the weak point of either
 * caller, but the correct comparison costs nothing and removes the question.
 *
 * Used by the two `verify_jwt = false` functions (whatsapp-webhook,
 * whatsapp-diary-digest), which authenticate with a shared secret because the
 * caller is a provider or cron, not a LexDiary user with a JWT.
 */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
