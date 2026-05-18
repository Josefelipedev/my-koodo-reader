export interface AdminSettingProps {
  t: (key: string) => string;
}

export interface AdminSettingState {
  users: { id: string; username: string; role: string; createdAt: number }[];
  loading: boolean;
  newUsername: string;
  newPassword: string;
  newRole: string;
  formError: string;
  formSuccess: string;
}
