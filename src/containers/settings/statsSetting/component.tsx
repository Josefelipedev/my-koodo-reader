import React from "react";
import { Trans } from "react-i18next";
import {
  StatsSettingProps,
  StatsSettingState,
  ActivityEntry,
  UserSummary,
} from "./interface";
import { getStoredCredentials, getStoredRole } from "../../../pages/appGate/component";
import toast from "react-hot-toast";

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
  return new Date(ts * 1000).toLocaleDateString();
}

function formatBadge(format: string) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
      background: "rgba(99,102,241,0.12)", color: "#6366f1",
      textTransform: "uppercase", letterSpacing: 0.5,
    }}>
      {format || "?"}
    </span>
  );
}

class StatsSetting extends React.Component<StatsSettingProps, StatsSettingState> {
  constructor(props: StatsSettingProps) {
    super(props);
    this.state = {
      activity: [],
      loading: false,
      usersActivity: [],
      usersLoading: false,
      expandedUser: null,
      userDetail: null,
      userDetailLoading: false,
    };
  }

  componentDidMount() {
    this.fetchMyActivity();
    if (getStoredRole() === "admin") {
      this.fetchUsersActivity();
    }
  }

  authHeaders() {
    return { Authorization: `Basic ${getStoredCredentials()}` };
  }

  fetchMyActivity = async () => {
    this.setState({ loading: true });
    try {
      const res = await fetch("/stats/me", { headers: this.authHeaders() });
      const data = await res.json();
      this.setState({ activity: data.activity || [], loading: false });
    } catch {
      this.setState({ loading: false });
      toast.error(this.props.t("Could not reach server. Try again."));
    }
  };

  fetchUsersActivity = async () => {
    this.setState({ usersLoading: true });
    try {
      const res = await fetch("/stats/users", { headers: this.authHeaders() });
      const data = await res.json();
      this.setState({ usersActivity: data.users || [], usersLoading: false });
    } catch {
      this.setState({ usersLoading: false });
    }
  };

  fetchUserDetail = async (username: string) => {
    if (this.state.expandedUser === username) {
      this.setState({ expandedUser: null, userDetail: null });
      return;
    }
    this.setState({ expandedUser: username, userDetailLoading: true, userDetail: null });
    try {
      const res = await fetch(
        `/stats/user?username=${encodeURIComponent(username)}`,
        { headers: this.authHeaders() }
      );
      const data = await res.json();
      this.setState({
        userDetail: { username, activity: data.activity || [] },
        userDetailLoading: false,
      });
    } catch {
      this.setState({ userDetailLoading: false });
    }
  };

  renderActivityRow(e: ActivityEntry) {
    return (
      <div key={e.book_key} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 0", borderBottom: "1px solid rgba(128,128,128,0.1)",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.book_name || "(untitled)"}
          </p>
          <p style={{ margin: 0, fontSize: 11, opacity: 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.book_author || "Unknown author"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {formatBadge(e.format)}
          <span style={{ fontSize: 11, opacity: 0.5, whiteSpace: "nowrap" }}>
            ×{e.open_count}
          </span>
          <span style={{ fontSize: 11, opacity: 0.5, whiteSpace: "nowrap" }}>
            {relativeTime(e.last_seen)}
          </span>
        </div>
      </div>
    );
  }

  renderUserRow(u: UserSummary) {
    const isExpanded = this.state.expandedUser === u.username;
    const { userDetail, userDetailLoading } = this.state;

    return (
      <div key={u.username}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "7px 6px", borderBottom: "1px solid rgba(128,128,128,0.1)",
            cursor: "pointer", borderRadius: 4,
            background: isExpanded ? "rgba(99,102,241,0.05)" : "transparent",
          }}
          onClick={() => this.fetchUserDetail(u.username)}
        >
          <span className="icon-user" style={{ fontSize: 14, opacity: 0.45 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{u.username}</span>
          <span style={{ fontSize: 11, opacity: 0.5 }}>{u.books_count} books · {u.total_opens} opens</span>
          <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>{relativeTime(u.last_active)}</span>
          <span
            className={isExpanded ? "icon-arrow-up" : "icon-arrow-down"}
            style={{ fontSize: 11, opacity: 0.4 }}
          />
        </div>

        {isExpanded && (
          <div style={{ paddingLeft: 24, paddingBottom: 8 }}>
            {userDetailLoading ? (
              <p style={{ fontSize: 12, opacity: 0.5, margin: "8px 0" }}>Loading…</p>
            ) : userDetail?.activity.length === 0 ? (
              <p style={{ fontSize: 12, opacity: 0.45, margin: "8px 0" }}>No activity yet.</p>
            ) : (
              userDetail?.activity.map((e) => this.renderActivityRow(e))
            )}
          </div>
        )}
      </div>
    );
  }

  render() {
    const { activity, loading, usersActivity, usersLoading } = this.state;
    const isAdmin = getStoredRole() === "admin";
    const totalOpens = activity.reduce((s, e) => s + e.open_count, 0);

    return (
      <div className="setting-dialog-info-content">

        {/* Summary chips */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Books opened", value: activity.length },
            { label: "Total sessions", value: totalOpens },
          ].map(({ label, value }) => (
            <div key={label} style={{
              flex: 1, padding: "12px 14px", borderRadius: 10,
              background: "rgba(99,102,241,0.08)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{value}</span>
              <span style={{ fontSize: 11, opacity: 0.55 }}><Trans>{label}</Trans></span>
            </div>
          ))}
        </div>

        {/* My recent activity */}
        <div style={{ marginBottom: isAdmin ? 28 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p className="setting-dialog-option-title" style={{ margin: 0 }}>
              <Trans>My Reading History</Trans>
            </p>
            <button
              className="general-setting-button"
              onClick={this.fetchMyActivity}
              style={{ fontSize: 12, padding: "3px 10px" }}
            >
              <Trans>Refresh</Trans>
            </button>
          </div>

          {loading ? (
            <p style={{ opacity: 0.5, fontSize: 13 }}>Loading…</p>
          ) : activity.length === 0 ? (
            <p style={{ opacity: 0.45, fontSize: 13 }}>
              <Trans>No reading activity recorded yet. Open a book to start tracking.</Trans>
            </p>
          ) : (
            <div>{activity.map((e) => this.renderActivityRow(e))}</div>
          )}
        </div>

        {/* Admin: all users */}
        {isAdmin && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <p className="setting-dialog-option-title" style={{ margin: 0 }}>
                <Trans>All Users Activity</Trans>
              </p>
              <button
                className="general-setting-button"
                onClick={this.fetchUsersActivity}
                style={{ fontSize: 12, padding: "3px 10px" }}
              >
                <Trans>Refresh</Trans>
              </button>
            </div>

            {usersLoading ? (
              <p style={{ opacity: 0.5, fontSize: 13 }}>Loading…</p>
            ) : usersActivity.length === 0 ? (
              <p style={{ opacity: 0.45, fontSize: 13 }}>
                <Trans>No activity recorded on the server yet.</Trans>
              </p>
            ) : (
              <div>{usersActivity.map((u) => this.renderUserRow(u))}</div>
            )}
          </div>
        )}
      </div>
    );
  }
}

export default StatsSetting;
