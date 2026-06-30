import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Clock, Image, Users } from "lucide-react";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ContentTypeBadge } from "@/components/dashboard/ContentTypeBadge";

export type RequestStatus = 
  | "submitted" 
  | "in_progress" 
  | "dept_review" 
  | "admin_approval" 
  | "scheduled" 
  | "completed";

export interface KanbanRequest {
  id: string;
  title: string;
  department: string;
  owner: string;
  status: RequestStatus;
  priority: "low" | "medium" | "high" | "emergency";
  mediaCount: number;
  targetScreens: number;
  thumbnail?: string;
  expiresAt?: string;
  conflictCount?: number;
  createdAt: string;
}

interface KanbanBoardProps {
  requests: KanbanRequest[];
  onRequestClick: (request: KanbanRequest) => void;
  onStatusChange: (requestId: string, newStatus: RequestStatus) => void;
}

const statusColumns: { status: RequestStatus; label: string; color: string }[] = [
  { status: "submitted", label: "Submitted", color: "bg-muted" },
  { status: "in_progress", label: "Operator In Progress", color: "bg-blue-500/10" },
  { status: "dept_review", label: "Dept Review", color: "bg-yellow-500/10" },
  { status: "admin_approval", label: "Admin Approval", color: "bg-purple-500/10" },
  { status: "scheduled", label: "Scheduled/Live", color: "bg-green-500/10" },
  { status: "completed", label: "Completed", color: "bg-muted" },
];

export function KanbanBoard({ requests, onRequestClick, onStatusChange }: KanbanBoardProps) {
  const [draggedRequest, setDraggedRequest] = useState<KanbanRequest | null>(null);

  const getRequestsByStatus = (status: RequestStatus) => {
    return requests.filter(r => r.status === status);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "emergency": return "border-l-4 border-l-destructive";
      case "high": return "border-l-4 border-l-warning";
      case "medium": return "border-l-4 border-l-info";
      default: return "border-l-4 border-l-muted";
    }
  };

  const handleDragStart = (request: KanbanRequest) => {
    setDraggedRequest(request);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (status: RequestStatus) => {
    if (draggedRequest && draggedRequest.status !== status) {
      onStatusChange(draggedRequest.id, status);
    }
    setDraggedRequest(null);
  };

  return (
    <div className="flex gap-4 h-full overflow-x-auto pb-4">
      {statusColumns.map((column) => {
        const columnRequests = getRequestsByStatus(column.status);
        
        return (
          <div
            key={column.status}
            className="flex-shrink-0 w-80 flex flex-col"
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(column.status)}
          >
            <div className={`rounded-t-lg p-3 ${column.color} border-b`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{column.label}</h3>
                <Badge variant="secondary" className="ml-2">
                  {columnRequests.length}
                </Badge>
              </div>
            </div>
            
            <ScrollArea className="flex-1 bg-accent/30 rounded-b-lg p-3">
              <div className="space-y-3">
                {columnRequests.map((request) => (
                  <Card
                    key={request.id}
                    draggable
                    onDragStart={() => handleDragStart(request)}
                    onClick={() => onRequestClick(request)}
                    className={`cursor-pointer hover:shadow-md transition-all ${getPriorityColor(request.priority)}`}
                  >
                    <CardHeader className="p-3 pb-2">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-sm leading-tight line-clamp-2">
                            {request.title}
                          </h4>
                          {request.conflictCount && request.conflictCount > 0 && (
                            <Badge variant="destructive" className="flex-shrink-0 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {request.conflictCount}
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {request.id}
                          </Badge>
                          <Badge className={
                            request.priority === "emergency" ? "bg-destructive text-destructive-foreground" :
                            request.priority === "high" ? "bg-warning text-warning-foreground" :
                            request.priority === "medium" ? "bg-info text-info-foreground" :
                            "bg-muted text-muted-foreground"
                          }>
                            {request.priority.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="p-3 pt-0 space-y-2">
                      {request.thumbnail && (
                        <div className="aspect-video bg-muted rounded overflow-hidden">
                          <img 
                            src={request.thumbnail} 
                            alt={request.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{request.department}</span>
                          <span>{request.owner}</span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Image className="h-3 w-3" />
                            <span>{request.mediaCount} items</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            <span>{request.targetScreens} screens</span>
                          </div>
                        </div>
                        
                        {request.expiresAt && (
                          <div className="flex items-center gap-1 text-warning">
                            <Clock className="h-3 w-3" />
                            <span>Expires: {request.expiresAt}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
                {columnRequests.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No requests in this stage
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
}
