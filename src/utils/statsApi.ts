import { isElectron } from "react-device-detect";
import BookModel from "../models/Book";
import { getStoredAuth, getStoredCredentials } from "../pages/appGate/component";

export function recordBookOpen(book: BookModel): void {
  if (isElectron || !getStoredAuth()) return;
  const cred = getStoredCredentials();
  if (!cred) return;
  fetch("/stats/open", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${cred}` },
    body: JSON.stringify({
      book_key: book.key,
      book_name: book.name || "",
      book_author: book.author || "",
      format: book.format || "",
    }),
  }).catch(() => {});
}
