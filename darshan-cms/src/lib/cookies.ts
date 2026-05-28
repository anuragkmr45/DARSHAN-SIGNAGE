export const getCookie = (name: string): string | undefined => {
  if (typeof document === "undefined") return undefined;

  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));

  if (!entry) return undefined;

  return decodeURIComponent(entry.slice(prefix.length));
};
