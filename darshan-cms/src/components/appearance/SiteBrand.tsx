import { useSiteAppearance } from "./SiteAppearanceProvider";

export function SiteBrand() {
  const { appearance } = useSiteAppearance();
  return <span className="flex min-w-0 items-center gap-3">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white p-1">
      <img src={appearance.logoUrl || appearance.iconUrl || "/darshan-mark.svg"} alt="" className="h-full w-full object-contain" />
    </span>
    <span className="truncate text-sm font-semibold tracking-wide">{appearance.appName}</span>
  </span>;
}
