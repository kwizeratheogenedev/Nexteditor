import { Component } from 'react';

// For optional extras (like the "while you were away" jobs banner): if one
// of them crashes, it simply disappears instead of taking the whole app down
// with it (AppErrorBoundary's "could not finish loading" screen).
export default class QuietErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(`${this.props.name || 'A page section'} failed and was hidden:`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
