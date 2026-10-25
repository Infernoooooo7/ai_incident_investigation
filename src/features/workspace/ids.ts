/** DOM id for a finding card, so it can be scrolled to and focused. */
export function findingDomId(findingId: string): string {
  return `finding-${findingId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
