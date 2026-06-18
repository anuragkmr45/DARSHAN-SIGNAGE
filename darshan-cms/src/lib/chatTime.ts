interface FormatChatTimeOptions {
  includeDate?: boolean;
  includeTime?: boolean;
  includeSeconds?: boolean;
  fallback?: string;
}

const DEFAULT_FALLBACK = "—";

const buildFormatter = (includeDate: boolean, includeTime: boolean, includeSeconds: boolean) =>
  new Intl.DateTimeFormat(undefined, {
    year: includeDate ? "numeric" : undefined,
    month: includeDate ? "short" : undefined,
    day: includeDate ? "2-digit" : undefined,
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
    second: includeTime && includeSeconds ? "2-digit" : undefined,
  });

export const formatChatTime = (
  iso?: string | null,
  options: FormatChatTimeOptions = {},
) => {
  if (!iso) return options.fallback ?? DEFAULT_FALLBACK;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return options.fallback ?? DEFAULT_FALLBACK;

  const includeDate = options.includeDate ?? true;
  const includeTime = options.includeTime ?? true;
  const includeSeconds = options.includeSeconds ?? false;
  return buildFormatter(includeDate, includeTime, includeSeconds).format(parsed);
};
