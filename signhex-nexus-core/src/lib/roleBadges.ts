const ROLE_BADGE_CLASSES = [
  "bg-blue-500/10 text-blue-700",
  "bg-emerald-500/10 text-emerald-700",
  "bg-amber-500/10 text-amber-700",
  "bg-purple-500/10 text-purple-700",
  "bg-rose-500/10 text-rose-700",
  "bg-cyan-500/10 text-cyan-700",
];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const getRoleBadgeClass = (roleName?: string) => {
  if (!roleName) return "bg-muted text-muted-foreground";
  const index = hashString(roleName) % ROLE_BADGE_CLASSES.length;
  return ROLE_BADGE_CLASSES[index] ?? ROLE_BADGE_CLASSES[0];
};
