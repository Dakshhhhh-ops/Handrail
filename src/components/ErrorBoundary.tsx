import { Component, type ReactNode } from 'react';

/** If anything ever breaks while drawing the page, say so plainly instead of showing a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  private download = () => {
    try {
      const data = localStorage.getItem('handrail:v1') ?? '{}';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'handrail-backup.json';
      a.click();
    } catch {
      /* nothing more we can do */
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Your boards are still saved on this device. Reloading usually fixes it.</p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.assign(window.location.pathname)}>
            Reload Handrail
          </button>
          <button type="button" className="btn btn-secondary" onClick={this.download}>
            Download my boards
          </button>
        </div>
      </main>
    );
  }
}
