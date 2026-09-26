/**
 * Returns the first unused "SheetN" name in positive-integer order for the
 * given existing worksheet names. Names are compared after trimming, and the
 * search starts at N=1 ("Sheet1"), so gaps left by renamed or deleted sheets
 * are filled before higher numbers are used.
 */
export function nextSheetName(existingNames: string[]): string {
  const used = new Set(existingNames.map((name) => name.trim()));
  let n = 1;
  while (used.has(`Sheet${n}`)) {
    n += 1;
  }
  return `Sheet${n}`;
}
