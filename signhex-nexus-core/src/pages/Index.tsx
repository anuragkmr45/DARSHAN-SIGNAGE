import { useNavigate } from "react-router-dom";
import { Monitor, Video, Calendar, Users, BarChart3, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const Index = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Monitor,
      title: "Screen Management",
      description: "Monitor and control all digital signage screens across your organization",
      path: "/screens",
    },
    {
      icon: Video,
      title: "Media Library",
      description: "Upload, organize, and manage all your digital content in one place",
      path: "/media-library",
    },
    {
      icon: Calendar,
      title: "Schedule Queue",
      description: "Plan and automate content scheduling with intelligent playlist management",
      path: "/schedule-queue",
    },
    {
      icon: Users,
      title: "Department Control",
      description: "Organize screens and content by department with granular permissions",
      path: "/departments",
    },
    {
      icon: BarChart3,
      title: "Analytics & Reports",
      description: "Track performance metrics and generate detailed activity reports",
      path: "/reports",
    },
    {
      icon: Settings,
      title: "System Settings",
      description: "Configure notifications, security, and advanced system preferences",
      path: "/settings",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <img src="/src/assets/signhex-logo.png" alt="SignHex" className="h-16" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            SignHex Digital Signage CMS
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Manage your digital signage network with powerful tools for content distribution,
            scheduling, and analytics
          </p>
          <div className="flex gap-4 justify-center mt-8">
            <Button size="lg" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/screens")}>
              View Screens
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <Card
              key={feature.path}
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary"
              onClick={() => navigate(feature.path)}
            >
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                </div>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card className="mt-12 bg-primary/5 border-primary/20">
          <CardContent className="p-8">
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-primary mb-2">247</div>
                <div className="text-sm text-muted-foreground">Active Screens</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-primary mb-2">1,248</div>
                <div className="text-sm text-muted-foreground">Media Assets</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-primary mb-2">93.5%</div>
                <div className="text-sm text-muted-foreground">System Uptime</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;
