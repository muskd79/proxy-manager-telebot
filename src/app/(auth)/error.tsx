"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Auth error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold">Authentication Error</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.message || "Something went wrong. Please try again."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={reset} variant="outline" size="sm">
            Try Again
          </Button>
          <Button onClick={() => window.location.href = "/login"} size="sm">
            Back to Login
          </Button>
        </div>
      </div>
    </div>
  );
}
