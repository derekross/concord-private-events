import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
          <div className="max-w-md w-full text-center space-y-4 p-6 bg-white/70 rounded-2xl border border-red-200">
            <div className="text-5xl">💥</div>
            <h2 className="text-xl font-bold text-red-800">Something went wrong</h2>
            <p className="text-sm text-gray-600">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.href = "/";
              }}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
            >
              ← Back to home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
