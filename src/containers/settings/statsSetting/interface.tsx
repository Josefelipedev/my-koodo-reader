export interface StatsSettingProps {
  t: (key: string) => string;
}

export interface ActivityEntry {
  book_key: string;
  book_name: string;
  book_author: string;
  format: string;
  first_opened: number;
  last_seen: number;
  open_count: number;
}

export interface UserSummary {
  username: string;
  books_count: number;
  last_active: number;
  total_opens: number;
}

export interface UserDetail {
  username: string;
  activity: ActivityEntry[];
}

export interface StatsSettingState {
  activity: ActivityEntry[];
  loading: boolean;
  usersActivity: UserSummary[];
  usersLoading: boolean;
  expandedUser: string | null;
  userDetail: UserDetail | null;
  userDetailLoading: boolean;
}
