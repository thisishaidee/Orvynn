/** Return a visible failure even when React Query retains cached initialData. */
export function getLeaseReadFailure(
  query: { isError: boolean; error: unknown },
  fallbackMessage: string,
): string | undefined {
  if (!query.isError) return undefined
  return query.error instanceof Error && query.error.message
    ? query.error.message
    : fallbackMessage
}
