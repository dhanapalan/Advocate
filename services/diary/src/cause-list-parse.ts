// Manual-import parsing: the only real source_type this build ships (see
// the cause_list_intelligence migration's header comment) — no live court
// API or scraper exists, so nothing here claims to synchronize live data.
// An advocate pastes rows copied from whatever they already have (a court's
// PDF cause list, a clerk's spreadsheet, a WhatsApp forward retyped into a
// spreadsheet) in a fixed column order, one listing per line.
//
// Columns, tab- or pipe-separated, in order:
//   serial number | case number | CNR | petitioner | respondent |
//   advocates | stage | court hall
// Every column past serial number is optional — a short line just leaves
// the trailing fields empty rather than erroring.

export type ParsedCauseListRow = {
  line: number;
  serialNumber: string | null;
  caseNumber: string | null;
  cnr: string | null;
  petitioner: string | null;
  respondent: string | null;
  advocateNames: string | null;
  stage: string | null;
  courtHall: string | null;
  sourceReference: string;
};

export type ParseResult = {
  rows: ParsedCauseListRow[];
  errors: { line: number; message: string }[];
};

function splitColumns(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : "|";
  return line.split(delimiter).map((cell) => cell.trim());
}

function cell(columns: string[], index: number): string | null {
  const value = columns[index]?.trim();
  return value ? value : null;
}

/**
 * source_reference identifies "the same listing" across two ingestions of
 * the same source — CNR first (most stable), case number next, and a
 * serial+date composite only when neither is present, per the migration's
 * documented fallback order.
 */
function buildSourceReference(
  listDate: string,
  cnr: string | null,
  caseNumber: string | null,
  serialNumber: string | null,
  line: number,
): string {
  if (cnr) return `cnr:${cnr.toUpperCase().replace(/\s+/g, "")}`;
  if (caseNumber) return `case:${caseNumber.toUpperCase().replace(/\s+/g, "")}`;
  if (serialNumber) return `serial:${listDate}:${serialNumber}`;
  // No stable identifier at all on this row — fall back to its position in
  // the paste. This means re-pasting the exact same list with rows
  // reordered will read as all-new, which is the honest outcome: nothing on
  // the row itself said otherwise.
  return `line:${listDate}:${line}`;
}

export function parseBulkCauseList(text: string, listDate: string): ParseResult {
  const rows: ParsedCauseListRow[] = [];
  const errors: { line: number; message: string }[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const columns = splitColumns(trimmed);
    const serialNumber = cell(columns, 0);
    const caseNumber = cell(columns, 1);
    const cnr = cell(columns, 2);
    const petitioner = cell(columns, 3);
    const respondent = cell(columns, 4);
    const advocateNames = cell(columns, 5);
    const stage = cell(columns, 6);
    const courtHall = cell(columns, 7);

    if (!caseNumber && !cnr && !petitioner) {
      errors.push({
        line,
        message: "Needs at least a case number, CNR, or petitioner name to be a usable row.",
      });
      return;
    }

    rows.push({
      line,
      serialNumber,
      caseNumber,
      cnr,
      petitioner,
      respondent,
      advocateNames,
      stage,
      courtHall,
      sourceReference: buildSourceReference(listDate, cnr, caseNumber, serialNumber, line),
    });
  });

  return { rows, errors };
}
