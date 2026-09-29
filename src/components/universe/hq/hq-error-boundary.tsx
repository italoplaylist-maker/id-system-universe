"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  onOpenListView: () => void;
}

interface State {
  failed: boolean;
}

/**
 * If the 3D world throws (a bad state, a WebGL context loss, anything),
 * administration keeps working — never let a rendering bug take down the
 * whole app (briefing 89).
 */
export class HqErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[hq] 3D view crashed:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">3D View Unavailable</p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => this.setState({ failed: false })}>
            Retry
          </Button>
          <Button variant="secondary" onClick={this.props.onOpenListView}>
            Open List View
          </Button>
        </div>
      </div>
    );
  }
}
