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

const typeConfig: Record<ContentType, { label: string; icon: typeof FileImage; color: string }> = {
  image: { label: "Image", icon: FileImage, color: "text-blue-600" },
  video: { label: "Video", icon: FileVideo, color: "text-purple-600" },
  pdf: { label: "PDF", icon: FileText, color: "text-red-600" },
  docx: { label: "DOCX", icon: FileText, color: "text-blue-700" },
  pptx: { label: "PPTX", icon: FileSpreadsheet, color: "text-orange-600" },
  csv: { label: "CSV", icon: FileSpreadsheet, color: "text-green-600" },
  link: { label: "Link", icon: Link2, color: "text-cyan-600" },
  html: { label: "HTML", icon: File, color: "text-gray-600" },
  document: { label: "Document", icon: FileText, color: "text-gray-700" },
};

export function ContentTypeBadge({ type, className }: ContentTypeBadgeProps) {
  const config = typeConfig[type];
  const Icon = config.icon;
  
  return (
    <Badge 
      variant="outline"
      className={cn("gap-1", className)}
    >
      <Icon className={cn("h-3 w-3", config.color)} />
      {config.label}
    </Badge>
  );
}
