import { X, FileText, Calendar, Monitor, MessageSquare, Clock, User, Tag, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { KanbanRequest } from "./KanbanBoard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ContentTypeBadge } from "@/components/dashboard/ContentTypeBadge";

interface ComprehensiveDetailDrawerProps {
  request: KanbanRequest;
  onClose: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onRequestChanges?: () => void;
}

export function ComprehensiveDetailDrawer({
  request,
  onClose,
  onApprove,
  onReject,
  onRequestChanges,
}: ComprehensiveDetailDrawerProps) {
  // Mock data for demonstration
  const mockMedia = [
    { id: "M1", name: "banner-main.jpg", type: "image" as const, duration: "10s", order: 1 },
    { id: "M2", name: "promo-video.mp4", type: "video" as const, duration: "45s", order: 2 },
    { id: "M3", name: "info-slide.pdf", type: "pdf" as const, duration: "15s", order: 3 },
  ];

  const mockScreens = [
    { id: "S1", name: "Main Lobby Display", location: "Building A", status: "online" as const },
    { id: "S2", name: "Cafeteria Board", location: "Building A", status: "online" as const },
    { id: "S3", name: "HR Display", location: "Building B", status: "offline" as const },
  ];

  const mockActivities = [
    { id: "A1", user: "Admin", action: "Approved request", timestamp: "2 hours ago", type: "approval" },
    { id: "A2", user: "John Doe", action: "Uploaded 3 media files", timestamp: "5 hours ago", type: "upload" },
    { id: "A3", user: "Sarah Chen", action: "Created request", timestamp: "1 day ago", type: "create" },
  ];

  const mockComments = [
    { id: "C1", user: "Admin", message: "Please adjust the color scheme to match brand guidelines", timestamp: "3 hours ago" },
    { id: "C2", user: "John Doe", message: "Updated the graphics as requested", timestamp: "1 hour ago" },
  ];

  return (
    <div className="flex h-full w-full min-w-0 flex-col rounded-lg border bg-background xl:w-[600px] xl:rounded-none xl:border-l xl:border-y-0 xl:border-r-0">
      {/* Header */}
      <div className="space-y-4 border-b p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{request.title}</h2>
              <StatusBadge status={request.status === "submitted" ? "pending" : 
                                   request.status === "in_progress" ? "in_review" :
                                   request.status === "scheduled" ? "live" : "approved"} />
            </div>
            <p className="text-sm text-muted-foreground">{request.id}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          {request.status === "dept_review" && (
            <>
              <Button size="sm" variant="default" onClick={onApprove}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={onRequestChanges}>
                Request Changes
              </Button>
              <Button size="sm" variant="destructive" onClick={onReject}>
                Reject
              </Button>
            </>
          )}
          {request.status === "admin_approval" && (
            <>
              <Button size="sm" variant="default" onClick={onApprove}>
                Publish
              </Button>
              <Button size="sm" variant="outline">
                Schedule
              </Button>
              <Button size="sm" variant="destructive" onClick={onReject}>
                Reject
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs Content */}
      <Tabs defaultValue="summary" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 h-auto justify-start gap-2 overflow-x-auto sm:mx-6">
          <TabsTrigger value="summary" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="media" className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Media
          </TabsTrigger>
          <TabsTrigger value="scheduling" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Scheduling
          </TabsTrigger>
          <TabsTrigger value="screens" className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Screens
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Activity
          </TabsTrigger>
        </TabsList>

        {/* Summary Tab */}
        <TabsContent value="summary" className="flex-1 mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-6 p-4 sm:p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Department</p>
                  <p className="font-medium">{request.department}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Owner</p>
                  <p className="font-medium">{request.owner}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Priority</p>
                  <Badge className={
                    request.priority === "emergency" ? "bg-destructive" :
                    request.priority === "high" ? "bg-warning" :
                    request.priority === "medium" ? "bg-info" : "bg-muted"
                  }>
                    {request.priority.toUpperCase()}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{request.createdAt}</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="font-semibold">Content Details</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Card>
                    <CardContent className="p-4 space-y-1">
                      <p className="text-sm text-muted-foreground">Media Items</p>
                      <p className="text-2xl font-bold">{request.mediaCount}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 space-y-1">
                      <p className="text-sm text-muted-foreground">Target Screens</p>
                      <p className="text-2xl font-bold">{request.targetScreens}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {request.conflictCount && request.conflictCount > 0 && (
                <>
                  <Separator />
                  <Card className="border-destructive bg-destructive/5">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-semibold text-destructive">
                            {request.conflictCount} Scheduling Conflict{request.conflictCount > 1 ? 's' : ''}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            This request conflicts with existing scheduled content. Review scheduling tab for details.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

              <Separator />

              <div className="space-y-3">
                <h3 className="font-semibold">Approvals</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>OP</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">Operator Review</p>
                        <p className="text-xs text-muted-foreground">Sarah Chen</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-success text-success-foreground">Approved</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>DM</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">Department Manager</p>
                        <p className="text-xs text-muted-foreground">Pending</p>
                      </div>
                    </div>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Media Tab */}
        <TabsContent value="media" className="flex-1 mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Media Items ({mockMedia.length})</h3>
                <Button size="sm" variant="outline">Add Media</Button>
              </div>
              
              <div className="space-y-3">
                {mockMedia.map((media, index) => (
                  <Card key={media.id}>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center justify-center w-10 h-10 bg-muted rounded font-semibold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{media.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <ContentTypeBadge type={media.type} />
                            <span className="text-xs text-muted-foreground">Duration: {media.duration}</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm">Edit</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Scheduling Tab */}
        <TabsContent value="scheduling" className="flex-1 mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-6 p-4 sm:p-6">
              <div className="space-y-4">
                <h3 className="font-semibold">Schedule Configuration</h3>
                
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Start Date & Time</label>
                    <Input type="datetime-local" defaultValue="2024-03-01T09:00" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">End Date & Time</label>
                    <Input type="datetime-local" defaultValue="2024-03-31T18:00" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Timezone</label>
                  <Input defaultValue="Asia/Kolkata" />
                </div>

                <Separator />

                <div className="space-y-2">
                  <label className="text-sm font-medium">Recurrence (RRULE)</label>
                  <Input placeholder="FREQ=DAILY;INTERVAL=1" />
                  <p className="text-xs text-muted-foreground">
                    Configure recurring schedules using RRULE format
                  </p>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Dayparting</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm">Start Time</label>
                      <Input type="time" defaultValue="09:00" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm">End Time</label>
                      <Input type="time" defaultValue="18:00" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Screens Tab */}
        <TabsContent value="screens" className="flex-1 mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Target Screens ({mockScreens.length})</h3>
                <Button size="sm" variant="outline">Add Screens</Button>
              </div>
              
              <div className="space-y-3">
                {mockScreens.map((screen) => (
                  <Card key={screen.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Monitor className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{screen.name}</p>
                            <p className="text-sm text-muted-foreground">{screen.location}</p>
                          </div>
                        </div>
                        <StatusBadge status={screen.status} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Separator />

              <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Monitor className="h-12 w-12 mx-auto mb-2" />
                  <p className="text-sm">9:16 Preview Mosaic</p>
                  <p className="text-xs">Multi-screen preview will appear here</p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="flex-1 mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-6 p-4 sm:p-6">
              {/* Comments Section */}
              <div className="space-y-4">
                <h3 className="font-semibold">Comments & Notes</h3>
                
                <div className="space-y-3">
                  {mockComments.map((comment) => (
                    <Card key={comment.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>{comment.user.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-medium text-sm">{comment.user}</p>
                              <p className="text-xs text-muted-foreground">{comment.timestamp}</p>
                            </div>
                            <p className="text-sm text-muted-foreground">{comment.message}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Textarea placeholder="Add a comment... Use @mentions to notify team members" />
                  <Button className="sm:self-end">Post</Button>
                </div>
              </div>

              <Separator />

              {/* Activity Timeline */}
              <div className="space-y-4">
                <h3 className="font-semibold">Activity Timeline</h3>
                
                <div className="space-y-3">
                  {mockActivities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <Clock className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{activity.user}</span>
                          {' '}{activity.action}
                        </p>
                        <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
