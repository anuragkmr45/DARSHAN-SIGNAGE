import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { Monitor, Users, TrendingUp, Shield, Zap, Globe } from "lucide-react";

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Monitor className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="truncate text-xl font-bold text-foreground sm:text-2xl">Signhex CMS</h1>
          </div>
          <Button onClick={() => navigate("/login")} variant="default" size="lg" className="w-full sm:w-auto">
            Sign In
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 text-center sm:px-6 sm:py-20">
        <div className="mx-auto max-w-4xl space-y-6">
          <h2 className="text-4xl font-bold text-foreground sm:text-5xl md:text-6xl">
            Enterprise Digital Signage
            <span className="text-primary"> Made Simple</span>
          </h2>
          <p className="mx-auto max-w-2xl text-base text-muted-foreground sm:text-xl">
            Manage thousands of screens, schedule content, and monitor your digital signage network in real-time with our powerful CMS platform.
          </p>
          <div className="flex flex-col justify-center gap-4 pt-6 sm:flex-row">
            <Button onClick={() => navigate("/login")} size="lg" className="text-lg px-8">
              Get Started
            </Button>
            <Button onClick={() => navigate("/login")} variant="outline" size="lg" className="text-lg px-8">
              Request Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-16 sm:px-6">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Card className="border-border hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Monitor className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Screen Management</h3>
              <p className="text-muted-foreground">
                Centrally manage and monitor all your digital displays with real-time status updates and health monitoring.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Content Scheduling</h3>
              <p className="text-muted-foreground">
                Schedule content with precision timing, approval workflows, and automated deployment across your network.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Team Collaboration</h3>
              <p className="text-muted-foreground">
                Multi-department support with role-based access control and collaborative content creation workflows.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Enterprise Security</h3>
              <p className="text-muted-foreground">
                SSO/OIDC integration, API keys, and comprehensive audit logs for enterprise-grade security.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Real-Time Updates</h3>
              <p className="text-muted-foreground">
                Instant content deployment with emergency takeover capabilities and live status monitoring.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Global Reach</h3>
              <p className="text-muted-foreground">
                Manage displays across multiple locations with timezone support and geo-targeted content delivery.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 sm:px-6">
        <Card className="bg-gradient-to-r from-primary to-primary/80 border-0">
          <CardContent className="space-y-6 p-6 text-center sm:p-10 md:p-12">
            <h3 className="text-2xl font-bold text-primary-foreground sm:text-3xl md:text-4xl">
              Ready to Transform Your Digital Signage?
            </h3>
            <p className="mx-auto max-w-2xl text-base text-primary-foreground/90 sm:text-xl">
              Join hundreds of enterprises managing millions of screens with Signhex CMS.
            </p>
            <Button 
              onClick={() => navigate("/login")} 
              size="lg" 
              variant="secondary"
              className="text-lg px-8"
            >
              Start Free Trial
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30">
        <div className="container mx-auto px-4 py-8 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Monitor className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">Signhex CMS</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2025 Signhex. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
