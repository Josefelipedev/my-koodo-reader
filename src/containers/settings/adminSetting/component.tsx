import React from "react";
import { Trans } from "react-i18next";
import { AdminSettingProps, AdminSettingState } from "./interface";
import { getStoredCredentials, getStoredUsername } from "../../../pages/appGate/component";
import toast from "react-hot-toast";

class AdminSetting extends React.Component<AdminSettingProps, AdminSettingState> {
  constructor(props: AdminSettingProps) {
    super(props);
    this.state = {
      users: [],
      loading: false,
      newUsername: "",
      newPassword: "",
      newRole: "member",
      formError: "",
      formSuccess: "",
    };
  }

  componentDidMount() {
    this.fetchUsers();
  }

  authHeaders() {
    return { Authorization: `Basic ${getStoredCredentials()}` };
  }

  fetchUsers = async () => {
    this.setState({ loading: true });
    try {
      const res = await fetch("/admin/users", { headers: this.authHeaders() });
      const data = await res.json();
      this.setState({ users: data.users || [], loading: false });
    } catch {
      this.setState({ loading: false });
      toast.error(this.props.t("Could not reach server. Try again."));
    }
  };

  handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const { newUsername, newPassword, newRole } = this.state;
    if (!newUsername || !newPassword) {
      this.setState({ formError: "Username and password are required" });
      return;
    }
    this.setState({ formError: "", formSuccess: "" });
    try {
      const res = await fetch("/admin/users", {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      if (res.status === 409) {
        this.setState({ formError: "Username already exists" });
        return;
      }
      if (!res.ok) {
        const txt = await res.text();
        this.setState({ formError: txt || "Error creating user" });
        return;
      }
      this.setState({ newUsername: "", newPassword: "", newRole: "member", formSuccess: "User created" });
      toast.success(this.props.t("Addition successful"));
      this.fetchUsers();
    } catch {
      this.setState({ formError: "Could not reach server" });
    }
  };

  handleDelete = async (username: string) => {
    if (!window.confirm(`Delete user "${username}"?`)) return;
    try {
      const res = await fetch(`/admin/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        const txt = await res.text();
        toast.error(txt || "Error deleting user");
        return;
      }
      toast.success(this.props.t("Deletion successful"));
      this.fetchUsers();
    } catch {
      toast.error(this.props.t("Could not reach server. Try again."));
    }
  };

  formatDate(ts: number) {
    return new Date(ts * 1000).toLocaleDateString();
  }

  render() {
    const { users, loading, newUsername, newPassword, newRole, formError, formSuccess } = this.state;
    const me = getStoredUsername();

    return (
      <div className="setting-dialog-info-content">
        {/* User list */}
        <div style={{ marginBottom: 24 }}>
          <p className="setting-dialog-option-title" style={{ marginBottom: 12 }}>
            <Trans>Library Users</Trans>
          </p>

          {loading ? (
            <p style={{ opacity: 0.5, fontSize: 13 }}>Loading…</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ opacity: 0.55, textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>Username</th>
                  <th style={{ padding: "4px 8px" }}>Role</th>
                  <th style={{ padding: "4px 8px" }}>Created</th>
                  <th style={{ padding: "4px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderTop: "1px solid rgba(128,128,128,0.15)" }}>
                    <td style={{ padding: "7px 8px", fontWeight: u.username === me ? 600 : 400 }}>
                      {u.username}
                      {u.username === me && (
                        <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.55 }}>(you)</span>
                      )}
                    </td>
                    <td style={{ padding: "7px 8px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: u.role === "admin" ? "rgba(99,102,241,0.15)" : "rgba(128,128,128,0.12)",
                          color: u.role === "admin" ? "#6366f1" : undefined,
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: "7px 8px", opacity: 0.6 }}>{this.formatDate(u.createdAt)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>
                      {u.username !== me && (
                        <span
                          className="icon-close"
                          style={{ cursor: "pointer", opacity: 0.5, fontSize: 13 }}
                          onClick={() => this.handleDelete(u.username)}
                          title="Delete user"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add user form */}
        <div>
          <p className="setting-dialog-option-title" style={{ marginBottom: 12 }}>
            <Trans>Add User</Trans>
          </p>
          <form onSubmit={this.handleCreate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="setting-dialog-input"
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => this.setState({ newUsername: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                className="setting-dialog-input"
                type="password"
                placeholder="Password"
                value={newPassword}
                onChange={(e) => this.setState({ newPassword: e.target.value })}
                style={{ flex: 1 }}
              />
              <select
                className="setting-dialog-input"
                value={newRole}
                onChange={(e) => this.setState({ newRole: e.target.value })}
                style={{ width: 100 }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {formError && <p style={{ color: "#ef4444", fontSize: 12, margin: 0 }}>{formError}</p>}
            {formSuccess && <p style={{ color: "#22c55e", fontSize: 12, margin: 0 }}>{formSuccess}</p>}
            <button
              className="general-setting-button"
              type="submit"
              style={{ alignSelf: "flex-start" }}
            >
              <Trans>Add User</Trans>
            </button>
          </form>
        </div>
      </div>
    );
  }
}

export default AdminSetting;
