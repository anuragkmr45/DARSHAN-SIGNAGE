export function invitationActivationLink(origin: string, token: string): string {
  const url = new URL("/activate", origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}
