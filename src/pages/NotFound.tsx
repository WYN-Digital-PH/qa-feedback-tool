import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-secondary/40">
      <div className="surface-elevated p-8 max-w-md w-full text-center">
        <div className="text-4xl font-bold tracking-tight">404</div>
        <h1 className="text-lg font-semibold mt-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mt-2">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button asChild className="mt-4">
          <Link to="/">Return home</Link>
        </Button>
      </div>
    </div>
  );
}
