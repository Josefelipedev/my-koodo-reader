export interface AdminSettingProps {
  t: (key: string) => string;
}

export interface CatalogBook {
  key: string;
  name: string;
  author: string;
  description: string;
  publisher: string;
  format: string;
  cover: string;
  size: number;
}

export interface AdminSettingState {
  activeTab: "users" | "catalog";
  // users tab
  users: { id: string; username: string; role: string; createdAt: number }[];
  loading: boolean;
  newUsername: string;
  newPassword: string;
  newRole: string;
  formError: string;
  formSuccess: string;
  // catalog tab
  books: CatalogBook[];
  booksLoading: boolean;
  editBook: CatalogBook | null;
  editTitle: string;
  editAuthor: string;
  editDesc: string;
  editPublisher: string;
  editSaving: boolean;
}
