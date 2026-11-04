import { Badge } from "@/components/ui/badge";
import { FileImage, FileVideo, FileText, FileSpreadsheet, Link2, File } from "lucide-react";
import { cn } from "@/lib/utils";

export type ContentType = 
  | "image" 
  | "video" 
  | "pdf" 
  | "docx" 
  | "pptx" 
  | "csv" 
  | "link"
  | "html"
  | "document";

interface ContentTypeBadgeProps {
  type: ContentType;
  className?: string;
}

const typeConfig: Record<ContentType, { label: string; icon: typeof FileImage }> = {
  image: { label: "Image", icon: FileImage },
  video: { label: "Video", icon: FileVideo },
  pdf: { label: "PDF", icon: FileText },
  docx: { label: "DOCX", icon: FileText },
  pptx: { label: "PPTX", icon: FileSpreadsheet },
  csv: { label: "CSV", icon: FileSpreadsheet },
  link: { label: "Link", icon: Link2 },
  html: { label: "HTML", icon: File },
  document: { label: "Document", icon: FileText },
};

export function ContentTypeBadge({ type, className }: ContentTypeBadgeProps) {
  const config = typeConfig[type];
  const Icon = config.icon;
  
  return (
    <Badge 
      variant="outline"
      className={cn("gap-1", className)}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
      {config.label}
    </Badge>
  );
}
