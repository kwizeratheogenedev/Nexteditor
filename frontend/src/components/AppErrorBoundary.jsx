import React from 'react';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error'
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Application render error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetStorage = () => {
    window.localStorage.clear();
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="app-crash-screen">
        <div className="app-crash-card">
          <p className="crash-eyebrow">Runtime Error</p>
          <h1>NexEditor could not finish loading</h1>
          <p className="crash-message">{this.state.message}</p>
          <div className="crash-actions">
            <button type="button" className="submit-btn" onClick={this.handleReload}>
              Reload App
            </button>
            <button type="button" className="reset-btn" onClick={this.handleResetStorage}>
              Reset Saved App State
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
