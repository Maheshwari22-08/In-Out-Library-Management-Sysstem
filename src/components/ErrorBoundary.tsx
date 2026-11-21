import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Application ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-xl font-semibold text-slate-900">
                System Recovery Required
              </h2>
            </div>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              The library portal encountered a runtime or permission error while processing your request.
            </p>
            <pre className="text-xs font-mono-tabular bg-slate-100 text-slate-800 p-3 rounded-lg overflow-x-auto mb-6 border border-slate-200">
              {this.state.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
