import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuthorization } from "@/hooks/useAuthorization";

const NotFound = () => {
  const { can } = useAuthorization();

  return (
    <section className="mx-auto flex min-h-[55dvh] max-w-lg flex-col items-start justify-center gap-4 py-8" aria-labelledby="not-found-title">
      <p className="text-sm font-medium text-muted-foreground">Page unavailable</p>
      <h1 id="not-found-title" className="text-2xl font-semibold tracking-tight">This page could not be found</h1>
      <p className="text-sm leading-6 text-muted-foreground">The address may have changed. Choose a page from the navigation to continue.</p>
      {can("read", "Dashboard") && <Button asChild><Link to="/dashboard">Open Dashboard</Link></Button>}
    </section>
  );
};

export default NotFound;
