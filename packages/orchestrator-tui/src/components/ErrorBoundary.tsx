import React from "react";
import { Box, Text } from "ink";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary that catches render errors in child components
 * and displays a fallback message instead of crashing the entire TUI.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="red">
            Something went wrong: {this.state.error.message}
          </Text>
        </Box>
      );
    }

    return this.props.children;
  }
}
