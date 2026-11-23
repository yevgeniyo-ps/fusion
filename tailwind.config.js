/** @type {import('tailwindcss').Config} */
// The design tokens: black surfaces, hairline rings,
// and the three status colours as the only colour. Fusion uses them for git state.
// Fonts, text greys and the syntax and terminal colours follow VS Code instead, for contrast.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#000000",
        panel: "#0a0a0c",
        card: "#101113",
        border: "#383c44",
        hover: "#17181a",
        // Brighter than a plain #7a7d85 / #4a4d55: these are VS Code's description and
        // disabled greys, readable on black for hours.
        muted: "#9d9d9d",
        faint: "#6e7681",
        text: "#cccccc",
        fg: "#e8eaed",
        accent: "#ffffff",
        "status-todo": "#a3a8b4",
        "status-progress": "#f4a93a",
        "status-done": "#6cd17b",
      },
      fontFamily: {
        // VS Code's fonts on macOS.
        sans: ["-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["Menlo", "Monaco", "SF Mono", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 2px 6px rgba(0,0,0,0.35), 0 12px 28px -10px rgba(0,0,0,0.55)",
        lift: "0 1px 0 rgba(255,255,255,0.06) inset, 0 10px 24px -6px rgba(0,0,0,0.55), 0 22px 50px -16px rgba(0,0,0,0.6)",
        float: "0 20px 50px -20px rgba(0,0,0,0.8), 0 2px 0 rgba(255,255,255,0.03) inset",
      },
    },
  },
  plugins: [],
};
