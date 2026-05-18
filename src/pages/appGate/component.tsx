import React from "react";
import "./appGate.css";
import { AppGateProps, AppGateState } from "./interface";

const AUTH_KEY = "koodoAppAuth";
const AUTH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getStoredAuth(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return false;
    const { at } = JSON.parse(raw);
    return Date.now() - at < AUTH_EXPIRY_MS;
  } catch {
    return false;
  }
}

export function getStoredUsername(): string {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "{}").username || "";
  } catch {
    return "";
  }
}

export function getStoredRole(): string {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "{}").role || "member";
  } catch {
    return "member";
  }
}

export function getStoredCredentials(): string {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "{}").cred || "";
  } catch {
    return "";
  }
}

export function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function saveAuth(username: string, cred: string, role: string) {
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ at: Date.now(), username, cred, role })
  );
}

class AppGate extends React.Component<AppGateProps, AppGateState> {
  constructor(props: AppGateProps) {
    super(props);
    this.state = {
      username: "",
      password: "",
      error: "",
      loading: false,
    };
  }

  handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { username, password } = this.state;
    if (!username || !password) {
      this.setState({ error: "Please enter username and password" });
      return;
    }

    this.setState({ loading: true, error: "" });

    try {
      const cred = btoa(`${username}:${password}`);

      // Validate credentials against the file server.
      const res = await fetch("/auth/me", {
        headers: { Authorization: `Basic ${cred}` },
      });

      if (res.ok) {
        const data = await res.json();
        const role: string = data.role || "member";
        saveAuth(username, cred, role);
        this.props.history.push("/manager/home");
      } else {
        this.setState({ error: "Invalid username or password", loading: false });
      }
    } catch {
      this.setState({
        error: "Could not reach server. Try again.",
        loading: false,
      });
    }
  };

  render() {
    const { username, password, error, loading } = this.state;

    return (
      <div className="app-gate-container">
        <div className="app-gate-card">
          <div className="app-gate-logo">
            <img src="./favicon.png" alt="Koodo Reader" width={56} height={56} />
          </div>
          <h1 className="app-gate-title">Koodo Reader</h1>
          <p className="app-gate-subtitle">Sign in to your library</p>

          <form className="app-gate-form" onSubmit={this.handleSubmit}>
            <div className="app-gate-field">
              <input
                className="app-gate-input"
                type="text"
                placeholder="Username"
                autoComplete="username"
                value={username}
                onChange={(e) => this.setState({ username: e.target.value })}
                disabled={loading}
              />
            </div>
            <div className="app-gate-field">
              <input
                className="app-gate-input"
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => this.setState({ password: e.target.value })}
                disabled={loading}
              />
            </div>

            {error && <p className="app-gate-error">{error}</p>}

            <button
              className="app-gate-button"
              type="submit"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }
}

export default AppGate;
