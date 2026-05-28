import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  subtleText?: string;
}

export function StatCard({ title, value, icon, subtleText }: StatCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {icon && <div className="p-2 bg-primary/10 rounded-lg">{icon}</div>}
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {subtleText && <p className="text-xs text-muted-foreground">{subtleText}</p>}
        </div>
      </div>
    </Card>
  );
}
