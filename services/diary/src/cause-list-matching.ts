// Deterministic, tiered cause-list → matter matching. No AI involved — every
// decision here is explainable from its inputs, which is the point: an
// advocate reviewing a "needs review" row must be able to see exactly why
// the engine landed there.
//
// Tier order (highest confidence first), per the K2 spec:
//   1. exact CNR                    — this CNR was matched to a matter before
//   2. exact case number + court    — normalized case_number and court both equal
//   3. strong case-number match     — normalized case_number equal, court not
//   4. party-name + court           — token-overlap on party names, court equal
//   5. advocate + context           — this tenant's own advocate named on the
//                                     listing, plus some party-name overlap
//
// Only tiers 1–2 are confident enough to auto-attach (status "matched").
// Every other tier — however plausible — lands as "needs_review": the spec
// is explicit that low-confidence records must never be auto-attached, only
// promoted by an advocate's own "Match Matter" action.

export type MatchMethod =
  "cnr" | "case_number" | "case_number_fuzzy" | "party_name" | "advocate_context" | "manual";

export type MatchStatus = "matched" | "needs_review" | "unmatched";

export type MatterCandidate = {
  id: string;
  title: string;
  caseNumber: string | null;
  court: string | null;
  opposingParty: string | null;
};

export type RecordToMatch = {
  caseNumber: string | null;
  cnr: string | null;
  court: string | null;
  petitioner: string | null;
  respondent: string | null;
  advocateNames: string | null;
};

export type MatchResult = {
  matterId: string | null;
  method: MatchMethod;
  confidence: number;
  status: MatchStatus;
};

const HONORIFICS = /\b(mr|mrs|ms|shri|smt|dr|m\/s|ltd|pvt|pvt\.|limited|private)\b/g;

export function normalizeCaseNumber(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || null;
}

export function normalizeCourt(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/\s+/g, " ");
  return cleaned || null;
}

function tokenizeParty(raw: string | null): Set<string> {
  if (!raw) return new Set();
  const cleaned = raw
    .toLowerCase()
    .replace(HONORIFICS, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set(cleaned.split(" ").filter((token) => token.length >= 3));
}

// Jaccard overlap on tokens — robust to word order and minor spelling
// differences ("Sunrise Developers Pvt Ltd" vs "Sunrise Developers") without
// needing a real fuzzy-string library.
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.min(a.size, b.size);
}

const PARTY_OVERLAP_THRESHOLD = 0.6;

function partyNamesOverlap(record: RecordToMatch, matter: MatterCandidate): boolean {
  const recordTokens = new Set([
    ...tokenizeParty(record.petitioner),
    ...tokenizeParty(record.respondent),
  ]);
  const matterTokens = new Set([
    ...tokenizeParty(matter.title),
    ...tokenizeParty(matter.opposingParty),
  ]);
  return tokenOverlap(recordTokens, matterTokens) >= PARTY_OVERLAP_THRESHOLD;
}

/**
 * priorCnrMatterId: if this exact CNR was already matched to a matter on an
 * earlier ingestion (looked up by the caller from cause_list_matches +
 * cause_list_records), pass that matter id here — that is tier 1. Without
 * a prior match, an incoming CNR alone is just an identifier with nothing to
 * confirm it against, so it cannot itself establish tier 1.
 */
export function matchCauseListRecord(
  record: RecordToMatch,
  candidates: MatterCandidate[],
  priorCnrMatterId: string | null,
  tenantAdvocateName: string | null,
): MatchResult {
  // Tier 1: exact CNR, previously confirmed.
  if (record.cnr && priorCnrMatterId) {
    return { matterId: priorCnrMatterId, method: "cnr", confidence: 1, status: "matched" };
  }

  const recordCaseNumber = normalizeCaseNumber(record.caseNumber);
  const recordCourt = normalizeCourt(record.court);

  if (recordCaseNumber) {
    const sameCaseNumber = candidates.filter(
      (m) => normalizeCaseNumber(m.caseNumber) === recordCaseNumber,
    );

    // Tier 2: exact case number + court.
    if (recordCourt) {
      const exact = sameCaseNumber.find((m) => normalizeCourt(m.court) === recordCourt);
      if (exact) {
        return { matterId: exact.id, method: "case_number", confidence: 0.95, status: "matched" };
      }
    }

    // Tier 3: case number alone, unambiguous (exactly one candidate).
    if (sameCaseNumber.length === 1) {
      return {
        matterId: sameCaseNumber[0]!.id,
        method: "case_number_fuzzy",
        confidence: 0.7,
        status: "needs_review",
      };
    }
    if (sameCaseNumber.length > 1) {
      // Ambiguous case number across multiple matters — surfaced for manual
      // review rather than guessing which one.
      return {
        matterId: null,
        method: "case_number_fuzzy",
        confidence: 0.3,
        status: "needs_review",
      };
    }
  }

  // Tier 4: party name + court.
  if (recordCourt) {
    const partyMatch = candidates.find(
      (m) => normalizeCourt(m.court) === recordCourt && partyNamesOverlap(record, m),
    );
    if (partyMatch) {
      return {
        matterId: partyMatch.id,
        method: "party_name",
        confidence: 0.5,
        status: "needs_review",
      };
    }
  }

  // Tier 5: this tenant's own advocate named on the listing, plus some party
  // overlap regardless of court (a listing can have the wrong/short court
  // name entered by the source).
  if (tenantAdvocateName && record.advocateNames) {
    const advocateTokens = tokenizeParty(tenantAdvocateName);
    const listedTokens = tokenizeParty(record.advocateNames);
    if (tokenOverlap(advocateTokens, listedTokens) > 0) {
      const contextMatch = candidates.find((m) => partyNamesOverlap(record, m));
      if (contextMatch) {
        return {
          matterId: contextMatch.id,
          method: "advocate_context",
          confidence: 0.35,
          status: "needs_review",
        };
      }
    }
  }

  return { matterId: null, method: "case_number_fuzzy", confidence: 0, status: "unmatched" };
}
