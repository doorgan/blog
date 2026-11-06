const INK = "#e5e6e6";
const SOFT = "#8a959a";
const PHOSPHOR = "#c084fc";
const TEAL = "#2dd4bf";
const ORANGE = "#fb923c";

/** Code blocks are always dark displays, so one theme covers both site themes. */
export const koTheme = {
  name: "ko",
  type: "dark",
  colors: { "editor.background": "#000005", "editor.foreground": INK },
  tokenColors: [
    { scope: ["comment"], settings: { foreground: SOFT } },
    {
      scope: ["keyword", "storage", "support.function.kernel"],
      settings: { foreground: PHOSPHOR },
    },
    {
      scope: ["string", "constant.other.symbol", "constant.language"],
      settings: { foreground: TEAL },
    },
    {
      scope: ["constant.numeric", "entity.name.type", "support.type"],
      settings: { foreground: ORANGE },
    },
    {
      scope: ["entity.name.function", "variable.other.constant"],
      settings: { foreground: "#ffffff" },
    },
  ],
};
