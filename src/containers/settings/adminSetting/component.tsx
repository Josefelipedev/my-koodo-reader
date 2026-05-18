import React from "react";
import { Trans } from "react-i18next";
import { AdminSettingProps, AdminSettingState, CatalogBook } from "./interface";
import { getStoredCredentials, getStoredUsername } from "../../../pages/appGate/component";
import toast from "react-hot-toast";

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

class AdminSetting extends React.Component<AdminSettingProps, AdminSettingState> {
  constructor(props: AdminSettingProps) {
    super(props);
    this.state = {
      activeTab: "users",
      users: [],
      loading: false,
      newUsername: "",
      newPassword: "",
      newRole: "member",
      formError: "",
      formSuccess: "",
      books: [],
      booksLoading: false,
      editBook: null,
      editTitle: "",
      editAuthor: "",
      editDesc: "",
      editPublisher: "",
      editSaving: false,
    };
  }

  componentDidMount() {
    this.fetchUsers();
  }

  authHeaders() {
    return { Authorization: `Basic ${getStoredCredentials()}` };
  }

  // ── Users ─────────────────────────────────────────────────────────────────

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

  handleDeleteUser = async (username: string) => {
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

  // ── Catalog ───────────────────────────────────────────────────────────────

  fetchBooks = async () => {
    this.setState({ booksLoading: true });
    try {
      const res = await fetch("/books/list", { headers: this.authHeaders() });
      const data = await res.json();
      this.setState({ books: data.books || [], booksLoading: false });
    } catch {
      this.setState({ booksLoading: false });
      toast.error(this.props.t("Could not reach server. Try again."));
    }
  };

  openEdit = (book: CatalogBook) => {
    this.setState({
      editBook: book,
      editTitle: book.name,
      editAuthor: book.author,
      editDesc: book.description,
      editPublisher: book.publisher,
    });
  };

  closeEdit = () => {
    this.setState({ editBook: null });
  };

  handleSaveEdit = async () => {
    const { editBook, editTitle, editAuthor, editDesc, editPublisher } = this.state;
    if (!editBook) return;
    this.setState({ editSaving: true });
    try {
      const res = await fetch(`/books/${encodeURIComponent(editBook.key)}`, {
        method: "PUT",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editTitle,
          author: editAuthor,
          description: editDesc,
          publisher: editPublisher,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        toast.error(txt || "Error saving");
        this.setState({ editSaving: false });
        return;
      }
      toast.success(this.props.t("Successfully saved"));
      this.setState({ editSaving: false, editBook: null });
      this.fetchBooks();
    } catch {
      toast.error(this.props.t("Could not reach server. Try again."));
      this.setState({ editSaving: false });
    }
  };

  handleDeleteBook = async (book: CatalogBook) => {
    if (!window.confirm(`Delete "${book.name}"?`)) return;
    try {
      const res = await fetch(`/books/${encodeURIComponent(book.key)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        const txt = await res.text();
        toast.error(txt || "Error deleting book");
        return;
      }
      toast.success(this.props.t("Deletion successful"));
      this.fetchBooks();
    } catch {
      toast.error(this.props.t("Could not reach server. Try again."));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  renderUsersTab() {
    const { users, loading, newUsername, newPassword, newRole, formError, formSuccess } = this.state;
    const me = getStoredUsername();

    return (
      <>
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
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: u.role === "admin" ? "rgba(99,102,241,0.15)" : "rgba(128,128,128,0.12)",
                        color: u.role === "admin" ? "#6366f1" : undefined,
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: "7px 8px", opacity: 0.6 }}>{this.formatDate(u.createdAt)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>
                      {u.username !== me && (
                        <span
                          className="icon-close"
                          style={{ cursor: "pointer", opacity: 0.5, fontSize: 13 }}
                          onClick={() => this.handleDeleteUser(u.username)}
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
            <button className="general-setting-button" type="submit" style={{ alignSelf: "flex-start" }}>
              <Trans>Add User</Trans>
            </button>
          </form>
        </div>
      </>
    );
  }

  renderCatalogTab() {
    const { books, booksLoading, editBook, editTitle, editAuthor, editDesc, editPublisher, editSaving } = this.state;

    return (
      <>
        {/* Edit modal */}
        {editBook && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center",
          }}
            onClick={(e) => { if (e.target === e.currentTarget) this.closeEdit(); }}
          >
            <div style={{
              width: 460, borderRadius: 12, padding: 24,
              background: "var(--background-color-2, #fff)",
              display: "flex", flexDirection: "column", gap: 14,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}><Trans>Edit Metadata</Trans></span>
                <span className="icon-close" style={{ cursor: "pointer", opacity: 0.5 }} onClick={this.closeEdit} />
              </div>

              {editBook.cover && (
                <img
                  src={`/cover/${editBook.cover}`}
                  alt=""
                  style={{ width: 80, height: 110, objectFit: "cover", borderRadius: 6, alignSelf: "center" }}
                />
              )}

              {[
                { label: "Title", val: editTitle, key: "editTitle" as const },
                { label: "Author", val: editAuthor, key: "editAuthor" as const },
                { label: "Publisher", val: editPublisher, key: "editPublisher" as const },
              ].map(({ label, val, key }) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, opacity: 0.6 }}><Trans>{label}</Trans></label>
                  <input
                    className="setting-dialog-input"
                    type="text"
                    value={val}
                    onChange={(e) => this.setState({ [key]: e.target.value } as any)}
                  />
                </div>
              ))}

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, opacity: 0.6 }}><Trans>Description</Trans></label>
                <textarea
                  className="setting-dialog-input"
                  value={editDesc}
                  rows={4}
                  style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
                  onChange={(e) => this.setState({ editDesc: e.target.value })}
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="upload-btn-secondary" onClick={this.closeEdit}>
                  <Trans>Cancel</Trans>
                </button>
                <button
                  className="upload-btn-primary"
                  disabled={editSaving}
                  onClick={this.handleSaveEdit}
                >
                  {editSaving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <p className="setting-dialog-option-title" style={{ margin: 0 }}>
            <Trans>Shared Catalog</Trans>
          </p>
          <button className="general-setting-button" onClick={this.fetchBooks} style={{ fontSize: 12, padding: "4px 12px" }}>
            <Trans>Refresh</Trans>
          </button>
        </div>

        {booksLoading ? (
          <p style={{ opacity: 0.5, fontSize: 13 }}>Loading…</p>
        ) : books.length === 0 ? (
          <p style={{ opacity: 0.45, fontSize: 13 }}><Trans>No books in the shared catalog yet.</Trans></p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {books.map((b) => (
              <div key={b.key} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "8px 10px", borderRadius: 8,
                background: "rgba(128,128,128,0.07)",
              }}>
                {b.cover ? (
                  <img
                    src={`/cover/${b.cover}`}
                    alt=""
                    style={{ width: 36, height: 50, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 36, height: 50, borderRadius: 4, flexShrink: 0,
                    background: "rgba(128,128,128,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, opacity: 0.4,
                  }}>
                    <span className="icon-book" />
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.name || "(no title)"}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.author || "Unknown author"} · {b.format?.toUpperCase()} · {formatBytes(b.size)}
                  </p>
                </div>

                <span
                  className="icon-edit"
                  style={{ cursor: "pointer", opacity: 0.55, fontSize: 16, flexShrink: 0 }}
                  title="Edit metadata"
                  onClick={() => this.openEdit(b)}
                />
                <span
                  className="icon-close"
                  style={{ cursor: "pointer", opacity: 0.45, fontSize: 13, flexShrink: 0 }}
                  title="Delete book"
                  onClick={() => this.handleDeleteBook(b)}
                />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  render() {
    const { activeTab } = this.state;

    return (
      <div className="setting-dialog-info-content">
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid rgba(128,128,128,0.15)", paddingBottom: 12 }}>
          {(["users", "catalog"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                this.setState({ activeTab: tab });
                if (tab === "catalog" && this.state.books.length === 0) this.fetchBooks();
              }}
              style={{
                padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
                background: activeTab === tab ? "#6366f1" : "transparent",
                color: activeTab === tab ? "#fff" : undefined,
                opacity: activeTab === tab ? 1 : 0.6,
                transition: "background 0.15s",
              }}
            >
              <Trans>{tab === "users" ? "Users" : "Catalog"}</Trans>
            </button>
          ))}
        </div>

        {activeTab === "users" ? this.renderUsersTab() : this.renderCatalogTab()}
      </div>
    );
  }
}

export default AdminSetting;
