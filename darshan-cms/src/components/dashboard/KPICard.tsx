import { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  onClick?: () => void;
  variant?: "default" | "success" | "warning" | "destructive";
}

export function KPICard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend, 
  onClick,
  variant = "default" 
}: KPICardProps) {
  const variantStyles = {
    default: "border-border",
    success: "border-success/25 bg-success/5",
    warning: "border-warning/25 bg-warning/5",
    destructive: "border-destructive/25 bg-destructive/5"
  };

  const CardWrapper = onClick ? Button : "div";
  const cardProps = onClick 
    ? { variant: "ghost" as const, className: "h-auto w-full p-0 text-left hover:bg-transparent" }
    : {};

  return (
    <CardWrapper {...cardProps} onClick={onClick}>
      <Card className={cn("h-full transition-all hover:-translate-y-0.5 hover:shadow-md", variantStyles[variant], onClick && "cursor-pointer")}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            {title}
          </CardTitle>
          <div className={cn(
            "rounded-lg p-2",
            variant === "success" && "bg-success/10 text-success",
            variant === "warning" && "bg-warning/10 text-warning",
            variant === "destructive" && "bg-destructive/10 text-destructive",
            variant === "default" && "bg-primary/10 text-primary"
          )}>
            <Icon className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
          {trend && (
            <p className={cn(
              "text-xs mt-2 font-medium",
              trend.isPositive ? "text-success" : "text-destructive"
            )}>
              {trend.value}
            </p>
          )}
        </CardContent>
      </Card>
    </CardWrapper>
  );
}
