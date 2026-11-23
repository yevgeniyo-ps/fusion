import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** True while the window is full screen. macOS hides the traffic lights then, so the tab
 *  bar must not keep their space. Checked again on each resize (entering or leaving it). */
export function useFullscreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const w = getCurrentWindow();
    const check = () => w.isFullscreen().then(setFull, () => {});
    check();
    const off = w.onResized(check);
    return () => {
      off.then((f) => f());
    };
  }, []);
  return full;
}

