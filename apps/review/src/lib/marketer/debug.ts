/** Operator / debug mode — exposes technical CAF details when enabled. */

export function isOperatorMode(searchParams: { get(name: string): string | null } | null): boolean {
  if (process.env.NEXT_PUBLIC_REVIEW_OPERATOR_MODE === "true") return true;
  return searchParams?.get("debug") === "1";
}
