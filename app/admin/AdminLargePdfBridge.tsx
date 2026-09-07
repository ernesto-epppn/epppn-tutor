"use client";

import { useEffect } from "react";

const LEGACY_LIMIT = 8 * 1024 * 1024;

export default function AdminLargePdfBridge() {
  useEffect(() => {
    const legacy = document.getElementById("epppn-file-input") as HTMLInputElement | null;
    if (!legacy) return;
    const form = legacy.closest("form");

    function handoff(selected: File) {
      if (selected.size <= LEGACY_LIMIT) return false;
      const largeInput = document.querySelector<HTMLInputElement>(".largeDrop input[type='file']");
      const shell = document.querySelector<HTMLElement>(".largePdfShell");
      if (!largeInput || !shell) return false;

      try {
        const transfer = new DataTransfer();
        transfer.items.add(selected);
        largeInput.files = transfer.files;
        largeInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        // If a browser blocks programmatic FileList assignment, the target zone
        // is still brought into view and the administrator can select it there.
      }

      shell.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    }

    const onChange = () => {
      const selected = legacy.files?.[0];
      if (selected) window.setTimeout(() => handoff(selected), 80);
    };

    const onSubmit = (event: Event) => {
      const selected = legacy.files?.[0];
      if (!selected || selected.size <= LEGACY_LIMIT) return;
      event.preventDefault();
      event.stopPropagation();
      handoff(selected);
    };

    legacy.addEventListener("change", onChange);
    form?.addEventListener("submit", onSubmit, true);
    return () => {
      legacy.removeEventListener("change", onChange);
      form?.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
