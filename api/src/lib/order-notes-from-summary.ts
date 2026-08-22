/**
 * Kitchen tickets store `itemsSummary` as `lines · notes`.
 * Delivery / takeaway notes themselves contain ` · ` (Customer · Phone · Address),
 * so taking only the last segment drops customer details from receipts.
 */
export function extractOrderNotesFromItemsSummary(summary: string): string | null {
  const trimmed = summary?.trim();
  if (!trimmed) return null;
  const channelMatch = trimmed.match(
    /\s·\s*((?:Delivery|Takeaway|Dine-in|Online|Foodpanda|Staff food)\b[\s\S]*)$/i,
  );
  if (channelMatch?.[1]?.trim()) return channelMatch[1].trim();
  const idx = trimmed.lastIndexOf(" · ");
  if (idx === -1) return null;
  const notes = trimmed.slice(idx + 3).trim();
  return notes || null;
}
