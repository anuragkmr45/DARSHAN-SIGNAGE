import { useState } from "react";
import { Plus, Trash2, Grid, Save, Eye, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mediaUrl?: string;
  aspectRatio: string;
}

interface FrameLayoutEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const layoutTemplates = [
  { id: "single", name: "Single Zone (Full)", zones: 1 },
  { id: "dual-horizontal", name: "Dual Horizontal", zones: 2 },
  { id: "dual-vertical", name: "Dual Vertical", zones: 2 },
  { id: "triple", name: "Triple Column", zones: 3 },
  { id: "quad", name: "Quad Grid", zones: 4 },
  { id: "custom", name: "Custom Layout", zones: 0 },
];

export function FrameLayoutEditor({ open, onOpenChange }: FrameLayoutEditorProps) {
  const [layoutName, setLayoutName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("single");
  const [zones, setZones] = useState<Zone[]>([
    {
      id: "zone-1",
      name: "Main Zone",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      aspectRatio: "16:9",
    },
  ]);
  const [selectedZone, setSelectedZone] = useState<string | null>("zone-1");

  const handleTemplateChange = (template: string) => {
    setSelectedTemplate(template);
    
    switch (template) {
      case "dual-horizontal":
        setZones([
          { id: "zone-1", name: "Top Zone", x: 0, y: 0, width: 100, height: 50, aspectRatio: "16:9" },
          { id: "zone-2", name: "Bottom Zone", x: 0, y: 50, width: 100, height: 50, aspectRatio: "16:9" },
        ]);
        break;
      case "dual-vertical":
        setZones([
          { id: "zone-1", name: "Left Zone", x: 0, y: 0, width: 50, height: 100, aspectRatio: "9:16" },
          { id: "zone-2", name: "Right Zone", x: 50, y: 0, width: 50, height: 100, aspectRatio: "9:16" },
        ]);
        break;
      case "triple":
        setZones([
          { id: "zone-1", name: "Left", x: 0, y: 0, width: 33, height: 100, aspectRatio: "9:16" },
          { id: "zone-2", name: "Center", x: 33, y: 0, width: 34, height: 100, aspectRatio: "9:16" },
          { id: "zone-3", name: "Right", x: 67, y: 0, width: 33, height: 100, aspectRatio: "9:16" },
        ]);
        break;
      case "quad":
        setZones([
          { id: "zone-1", name: "Top Left", x: 0, y: 0, width: 50, height: 50, aspectRatio: "1:1" },
          { id: "zone-2", name: "Top Right", x: 50, y: 0, width: 50, height: 50, aspectRatio: "1:1" },
          { id: "zone-3", name: "Bottom Left", x: 0, y: 50, width: 50, height: 50, aspectRatio: "1:1" },
          { id: "zone-4", name: "Bottom Right", x: 50, y: 50, width: 50, height: 50, aspectRatio: "1:1" },
        ]);
        break;
      default:
        setZones([
          { id: "zone-1", name: "Main Zone", x: 0, y: 0, width: 100, height: 100, aspectRatio: "16:9" },
        ]);
    }
  };

  const handleAddZone = () => {
    const newZone: Zone = {
      id: `zone-${zones.length + 1}`,
      name: `Zone ${zones.length + 1}`,
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      aspectRatio: "16:9",
    };
    setZones([...zones, newZone]);
    toast.success("New zone added");
  };

  const handleRemoveZone = (zoneId: string) => {
    setZones(zones.filter(z => z.id !== zoneId));
    if (selectedZone === zoneId) {
      setSelectedZone(null);
    }
    toast.success("Zone removed");
  };

  const handleUpdateZone = (zoneId: string, updates: Partial<Zone>) => {
    setZones(zones.map(z => z.id === zoneId ? { ...z, ...updates } : z));
  };

  const handleSaveLayout = () => {
    toast.success("Layout template saved successfully");
    onOpenChange(false);
  };

  const selectedZoneData = zones.find(z => z.id === selectedZone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Frame/Layout Editor</DialogTitle>
          <DialogDescription>
            Design multi-zone layouts for your displays
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden lg:h-[min(70svh,800px)] lg:flex-row">
          {/* Left Panel - Controls */}
          <div className="w-full space-y-4 overflow-y-auto lg:w-80">
            <div className="space-y-2">
              <Label htmlFor="layout-name">Layout Name</Label>
              <Input
                id="layout-name"
                placeholder="e.g., Lobby Triple Screen"
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {layoutTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label>Zones ({zones.length})</Label>
              <Button size="sm" variant="outline" onClick={handleAddZone}>
                <Plus className="h-3 w-3 mr-1" />
                Add Zone
              </Button>
            </div>

            <div className="space-y-2">
              {zones.map((zone) => (
                <Card
                  key={zone.id}
                  className={`p-3 cursor-pointer transition-colors ${
                    selectedZone === zone.id ? "border-primary bg-accent" : ""
                  }`}
                  onClick={() => setSelectedZone(zone.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{zone.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {zone.width}% × {zone.height}% | {zone.aspectRatio}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveZone(zone.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {selectedZoneData && (
              <Card className="p-4 space-y-4">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Zone Properties
                </h4>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={selectedZoneData.name}
                      onChange={(e) =>
                        handleUpdateZone(selectedZone, { name: e.target.value })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">X Position (%)</Label>
                      <Input
                        type="number"
                        value={selectedZoneData.x}
                        onChange={(e) =>
                          handleUpdateZone(selectedZone, { x: Number(e.target.value) })
                        }
                        min={0}
                        max={100}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Y Position (%)</Label>
                      <Input
                        type="number"
                        value={selectedZoneData.y}
                        onChange={(e) =>
                          handleUpdateZone(selectedZone, { y: Number(e.target.value) })
                        }
                        min={0}
                        max={100}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Width (%)</Label>
                      <Input
                        type="number"
                        value={selectedZoneData.width}
                        onChange={(e) =>
                          handleUpdateZone(selectedZone, { width: Number(e.target.value) })
                        }
                        min={1}
                        max={100}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Height (%)</Label>
                      <Input
                        type="number"
                        value={selectedZoneData.height}
                        onChange={(e) =>
                          handleUpdateZone(selectedZone, { height: Number(e.target.value) })
                        }
                        min={1}
                        max={100}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Aspect Ratio</Label>
                    <Select
                      value={selectedZoneData.aspectRatio}
                      onValueChange={(value) =>
                        handleUpdateZone(selectedZone, { aspectRatio: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                        <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                        <SelectItem value="4:3">4:3</SelectItem>
                        <SelectItem value="1:1">1:1 (Square)</SelectItem>
                        <SelectItem value="21:9">21:9 (Ultra-wide)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Right Panel - Preview */}
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">
                <Grid className="h-3 w-3 mr-1" />
                Preview (9:16)
              </Badge>
              <div className="flex gap-2">
                <Button size="sm" variant="outline">
                  <Eye className="h-3 w-3 mr-1" />
                  Toggle 16:9
                </Button>
              </div>
            </div>

            <Card className="relative min-h-[20rem] bg-muted p-4 lg:flex-1">
              <div className="relative mx-auto aspect-[9/16] h-full max-h-[70svh] w-full max-w-md overflow-hidden rounded-lg border-2 border-dashed border-border bg-background">
                {zones.map((zone) => (
                  <div
                    key={zone.id}
                    className={`absolute border-2 transition-all cursor-pointer ${
                      selectedZone === zone.id
                        ? "border-primary bg-primary/10 z-10"
                        : "border-muted-foreground/30 bg-accent/50"
                    }`}
                    style={{
                      left: `${zone.x}%`,
                      top: `${zone.y}%`,
                      width: `${zone.width}%`,
                      height: `${zone.height}%`,
                    }}
                    onClick={() => setSelectedZone(zone.id)}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-xs font-semibold">{zone.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {zone.width}×{zone.height} | {zone.aspectRatio}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveLayout}>
                <Save className="h-4 w-4 mr-2" />
                Save Template
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
