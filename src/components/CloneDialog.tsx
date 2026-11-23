import { useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import type { Project } from "../types";
import { Modal } from "./Modal";

const PARENT_KEY = "fusion.clone.parent";

/** "git@github.com:org/api.git" and "https://github.com/org/api" give "api". */
const repoName = (url: string) => url.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "";

function savedParent(): string {
  try {
    return localStorage.getItem(PARENT_KEY) || "~/code";
  } catch {
    return "~/code";
  }
}

interface Props {
  open: boolean;
  canAddToTab: boolean;
  onClose: () => void;
  onDone: (p: Project, addToTab: boolean) => void;
}

export function CloneDialog({ open: shown, canAddToTab, onClose, onDone }: Props) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(savedParent);
  const [name, setName] = useState("");
  const [toTab, setToTab] = useState(true);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finalName = name.trim() || repoName(url);

  const pickParent = async () => {
    const dir = await open({ directory: true, defaultPath: parent.startsWith("~") ? undefined : parent });
    if (typeof dir === "string") setParent(dir);
  };

  const clone = async () => {
    if (!url.trim() || !finalName || busy) return;
    setBusy(true);
    setError(null);
    setLine("Starting git clone…");
    const progress = new Channel<string>();
    progress.onmessage = setLine;
    try {
      const p = await api.projectClone(url.trim(), parent, finalName, progress);
      try {
        localStorage.setItem(PARENT_KEY, parent);
      } catch {
        /* private storage: the folder is just not remembered */
      }
      onDone(p, canAddToTab && toTab);
      setUrl("");
      setName("");
      setLine("");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = "h-[28px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 text-[13px] text-text placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none";

  return (
    <Modal
      open={shown}
      onClose={busy ? () => {} : onClose}
      title="Clone Repository"
      footer={
        <>
          <button onClick={onClose} disabled={busy} className="h-[26px] rounded-[4px] bg-[#313131] px-3.5 text-[13px] text-text hover:bg-[#3c3c3c] disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={clone}
            disabled={busy || !url.trim() || !finalName}
            className="h-[26px] rounded-[4px] bg-[#0078d4] px-3.5 text-[13px] text-white hover:bg-[#026ec1] disabled:opacity-40"
          >
            {busy ? "Cloning…" : "Clone"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-text">Repository URL</span>
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && clone()}
            placeholder="git@github.com:org/repo.git"
            spellCheck={false}
            className={`${field} font-mono`}
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-[13px] text-text">Parent folder</span>
            <div className="flex gap-2">
              <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} className={`${field} font-mono`} />
              <button onClick={pickParent} className="h-[28px] shrink-0 rounded-[4px] bg-[#313131] px-3 text-[13px] text-text hover:bg-[#3c3c3c]">
                Browse…
              </button>
            </div>
          </label>
          <label className="flex w-40 flex-col gap-1.5">
            <span className="text-[13px] text-text">Folder name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={repoName(url) || "repo"} spellCheck={false} className={`${field} font-mono`} />
          </label>
        </div>
        {canAddToTab && (
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input type="checkbox" checked={toTab} onChange={(e) => setToTab(e.target.checked)} className="accent-[#0078d4]" />
            Add it to the open tab
          </label>
        )}
        {busy && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="rel-progress h-full w-2/5 rounded-full bg-[#0078d4]" />
            </div>
            <span className="truncate font-mono text-[12px] text-muted">{line}</span>
          </div>
        )}
        {error && <div className="rounded-[4px] border border-[#be1100] bg-[#5a1d1d] px-3 py-2 font-mono text-[12px] text-[#f48771]">{error}</div>}
      </div>
    </Modal>
  );
}
