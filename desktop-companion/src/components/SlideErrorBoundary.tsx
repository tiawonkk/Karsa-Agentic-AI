import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
  slideName: string;
  isDark?: boolean;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class SlideErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[SlideErrorBoundary] Error in slide "${this.props.slideName}":`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      const isDark = this.props.isDark !== false;
      return (
        <div
          className={`w-full h-full flex flex-col items-center justify-center p-3 rounded-2xl text-center select-none ${
            isDark
              ? "bg-rose-950/30 border border-rose-500/20 text-rose-200"
              : "bg-rose-50 border border-rose-200 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1 text-rose-500">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs font-semibold">{this.props.slideName} Error</span>
          </div>
          <p className="text-[10px] opacity-80 max-w-xs truncate mb-2">
            {this.state.error?.message || "Terjadi kesalahan visual slide"}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer ${
              isDark
                ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30"
                : "bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300"
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Muat Ulang Slide</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default SlideErrorBoundary;
