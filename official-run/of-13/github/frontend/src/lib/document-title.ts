import { useEffect } from "react";

export const DEFAULT_DOCUMENT_TITLE = "GitHub Collaboration Platform";

/** Keeps the browser tab title in step with the page the user is viewing. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ?? DEFAULT_DOCUMENT_TITLE;
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [title]);
}
