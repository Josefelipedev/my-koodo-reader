import { isElectron } from "react-device-detect";
import {
  getStoredAuth,
  getStoredCredentials,
} from "../pages/appGate/component";
import { ConfigService } from "../assets/lib/kookit-extra-browser.min";

export async function autoImportServerBooks(
  importBookFunc: (file: File) => Promise<void>
): Promise<void> {
  if (isElectron || !getStoredAuth()) return;

  const cred = getStoredCredentials();
  if (!cred) return;

  let books: Array<{ key: string; name: string; format: string }>;
  try {
    const res = await fetch("/books/list", {
      headers: { Authorization: `Basic ${cred}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    books = data.books || [];
  } catch {
    return;
  }

  if (books.length === 0) return;

  const imported = ConfigService.getAllListConfig("importedServerBooks") || {};

  for (const book of books) {
    if (imported[book.key]) continue;

    try {
      const ext = book.format.toLowerCase();
      const fileRes = await fetch(`/book/${book.key}.${ext}`, {
        headers: { Authorization: `Basic ${cred}` },
      });
      if (!fileRes.ok) continue;

      const blob = await fileRes.blob();
      const filename = (book.name || book.key).replace(/[/\\?%*:|"<>]/g, "-") + "." + ext;
      const file = new File([blob], filename);

      await importBookFunc(file);
      ConfigService.setListConfig(book.key, "importedServerBooks");
    } catch {
      // skip individual failures silently
    }
  }
}
