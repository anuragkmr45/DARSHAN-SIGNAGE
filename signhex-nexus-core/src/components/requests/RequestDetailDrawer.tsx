import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, XCircle, Clock, Calendar, User, Tag } from "lucide-react";

interface Request {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  submittedBy: {
    name: string;
    avatar?: string;
    role: string;
  };
  submittedAt: string;
  priority: string;
  department?: string;
}

interface RequestDetailDrawerProps {
  request: Request | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestDetailDrawer({
  request,
  open,
  onOpenChange,
}: RequestDetailDrawerProps) {
  if (!request) return null;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "rejected":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-4xl">
          <DrawerHeader>
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={request.submittedBy.avatar} />
                <AvatarFallback>
                  {request.submittedBy.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  {getStatusIcon(request.status)}
                  <DrawerTitle>{request.title}</DrawerTitle>
                </div>
                <DrawerDescription>{request.description}</DrawerDescription>
              </div>
            </div>
          </DrawerHeader>

          <div className="px-4 space-y-6">
            <Separator />

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Submitted By</p>
                    <p className="text-sm text-muted-foreground">
                      {request.submittedBy.name} • {request.submittedBy.role}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Submitted At</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(request.submittedAt).toLocaleString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Tag className="h-5 w-5 text-muted-foreground" />
                  <div className="flex gap-2">
                    <Badge variant="outline" className="capitalize">
                      {request.type}
                    </Badge>
                    <Badge
                      variant={
                        request.status === "approved"
                          ? "default"
                          : request.status === "rejected"
                          ? "destructive"
                          : "secondary"
                      }
                      className="capitalize"
                    >
                      {request.status}
                    </Badge>
                  </div>
                </div>

                {request.department && (
                  <div>
                    <p className="text-sm font-medium mb-1">Department</p>
                    <Badge variant="outline">{request.department}</Badge>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium mb-1">Priority</p>
                  <Badge
                    variant="outline"
                    className={
                      request.priority === "high"
                        ? "bg-red-100 text-red-800 border-red-200"
                        : request.priority === "medium"
                        ? "bg-yellow-100 text-yellow-800 border-yellow-200"
                        : "bg-blue-100 text-blue-800 border-blue-200"
                    }
                  >
                    {request.priority}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="font-semibold mb-2">Request Details</h4>
              <p className="text-sm text-muted-foreground">{request.description}</p>
            </div>
          </div>

          <DrawerFooter>
            {request.status === "pending" ? (
              <div className="flex gap-2">
                <Button className="flex-1">
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve Request
                </Button>
                <Button variant="destructive" className="flex-1">
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject Request
                </Button>
              </div>
            ) : (
              <DrawerClose asChild>
                <Button variant="outline">Close</Button>
              </DrawerClose>
            )}
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
