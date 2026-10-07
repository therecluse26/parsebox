import type { SecretFinding } from "@/lib/convert/types";

// STUB: the secrets feature renders the findings and the redact toggle here
export function SecretsNotice(_props: {
  secrets: SecretFinding[] | null;
  redact: boolean;
  onRedactChange: (redact: boolean) => void;
}) {
  return null;
}
