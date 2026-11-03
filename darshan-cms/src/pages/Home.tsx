import { ArrowRight, CalendarDays, Monitor, Radio } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/store/hooks";

const workspaceAreas = [
  { icon: CalendarDays, title: "Plan content", detail: "Schedule and publish what plays on each screen." },
  { icon: Monitor, title: "See screen health", detail: "Find devices that need attention and inspect current playback." },
  { icon: Radio, title: "Respond to events", detail: "Manage live events and urgent messages from the same workspace." },
];

const Home = () => {
  const signedIn = useAppSelector((state) => Boolean(state.auth.user));

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8">
          <img src="/darshan-mark.svg" alt="" className="h-9 w-9" />
          <span className="text-sm font-semibold tracking-wide">DARSHAN</span>
          <span className="ml-auto text-xs text-muted-foreground">Display operations</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-12 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:gap-20 lg:py-28">
        <section className="max-w-xl" aria-labelledby="home-title">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Your site workspace</p>
          <h1 id="home-title" className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Keep every display on course.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            Plan content, monitor screens, and respond to events from your on-premises DARSHAN console.
          </p>
          <Button asChild size="lg" className="mt-8 min-h-11 gap-2">
            <Link to={signedIn ? "/dashboard" : "/login"}>
              {signedIn ? "Open workspace" : "Sign in to DARSHAN"}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">Access is provided by your site administrator.</p>
        </section>

        <section aria-label="What you can do" className="self-center border-t border-border/70 lg:border-l lg:border-t-0 lg:pl-8">
          {workspaceAreas.map(({ icon: Icon, title, detail }) => (
            <div key={title} className="flex gap-3 border-b border-border/70 py-5 first:pt-5 last:border-0">
              <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
};

export default Home;
