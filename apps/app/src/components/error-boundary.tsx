/** @jsxImportSource react */
/**
 * Generic React error boundary.
 *
 * Used to scope a render-time crash to the offending component tree
 * (e.g. the Review panel) so the rest of the app — sidebar, chat,
 * the other tabs — keeps working. The fallback offers a "Reload" CTA
 * that resets the boundary and re-renders children.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** Short title shown above the error message. */
  title?: string;
  /** Optional stable reset key — bump it to force a reset from outside. */
  resetKey?: string | number;
  /** Render slot for the "Reload" action. */
  onReset?: () => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface to the dev console so engineers can find the trace.
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <div className="text-base font-semibold text-foreground">
            {this.props.title ?? "Something went wrong"}
          </div>
          <p className="max-w-xs text-xs leading-relaxed">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={this.handleReset}
            aria-label="Reload this panel"
          >
            Reload
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
