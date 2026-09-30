/**
 * Visible texts of the worksheet lifecycle (REQ-2-1-4) the client shows on its own: the refusal a
 * `Delete` reports when it would leave the workbook empty (the server repeats the check), and the
 * refusal that closes the confirmation dialog when a pivot table still reads the worksheet.
 */
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
