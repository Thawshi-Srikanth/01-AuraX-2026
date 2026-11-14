import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside component tree:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-6 bg-bg-app select-none">
          <div className="max-w-md w-full bg-bg-surface border border-border-strong rounded p-6 space-y-4 text-center">
            <div className="w-10 h-10 rounded-full bg-bg-raised border border-border-subtle mx-auto flex items-center justify-center text-science-error">
              <AlertCircle size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-[14px] font-semibold text-text-primary">
                Display Rendering Interrupted
              </h3>
              <p className="text-[12px] text-text-secondary break-all">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-flex items-center space-x-2 px-3 py-1.5 bg-bg-raised hover:bg-bg-hover border border-border-subtle rounded text-[12px] font-medium text-text-primary transition-colors"
            >
              <RotateCcw size={14} />
              <span>Retry Component</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
