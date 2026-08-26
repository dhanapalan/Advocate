// Pure diff between two ingestions of "the same listing" (matched by
// source_reference within a source — see cause-list.functions.ts). One
// record can produce several change rows (e.g. both hall_changed and
// stage_changed in the same re-ingestion) — each is its own explainable
// fact, not a single collapsed "something changed" flag.

export type ChangeType =
  | "new_listing"
  | "date_changed"
  | "serial_changed"
  | "hall_changed"
  | "bench_changed"
  | "stage_changed"
  | "unchanged"
  | "removed";

export type DetectedChange = {
  changeType: ChangeType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
};

export type ComparableRecord = {
  listDate: string;
  serialNumber: string | null;
  courtHall: string | null;
  bench: string | null;
  stage: string | null;
};

function normalized(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** previous === null means this source_reference has never been seen before. */
export function detectChanges(
  previous: ComparableRecord | null,
  current: ComparableRecord,
): DetectedChange[] {
  if (!previous) {
    return [{ changeType: "new_listing", fieldName: null, oldValue: null, newValue: null }];
  }

  const fields: { key: keyof ComparableRecord; changeType: ChangeType; label: string }[] = [
    { key: "listDate", changeType: "date_changed", label: "list_date" },
    { key: "serialNumber", changeType: "serial_changed", label: "serial_number" },
    { key: "courtHall", changeType: "hall_changed", label: "court_hall" },
    { key: "bench", changeType: "bench_changed", label: "bench" },
    { key: "stage", changeType: "stage_changed", label: "stage" },
  ];

  const changes: DetectedChange[] = [];
  for (const field of fields) {
    const oldValue = normalized(previous[field.key]);
    const newValue = normalized(current[field.key]);
    if (oldValue !== newValue) {
      changes.push({ changeType: field.changeType, fieldName: field.label, oldValue, newValue });
    }
  }

  if (changes.length === 0) {
    return [{ changeType: "unchanged", fieldName: null, oldValue: null, newValue: null }];
  }
  return changes;
}

/**
 * Listings that existed in the previous ingestion of a source/date but are
 * absent from the current one — a real cause-list fact ("no longer listed
 * today"), not silently dropped. Returns the source_references to mark.
 */
export function findRemovedReferences(
  previousReferences: string[],
  currentReferences: Set<string>,
): string[] {
  return previousReferences.filter((ref) => !currentReferences.has(ref));
}
