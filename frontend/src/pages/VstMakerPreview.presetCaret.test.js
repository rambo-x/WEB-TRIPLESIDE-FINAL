import fs from "fs";
import path from "path";

describe("Preset Browser text caret theme", () => {
  const styles = fs.readFileSync(path.join(__dirname, "VstMakerPreview.css"), "utf8");

  test("uses the active project theme for the caret and focused field", () => {
    expect(styles).toContain(".maker-panel-preset-toolbar input:focus");
    expect(styles).toContain("caret-color: var(--maker-accent)");
    expect(styles).toContain("border-color: color-mix(in srgb, var(--maker-accent) 72%, white)");
    expect(styles).toContain("box-shadow: 0 0 0 2px color-mix(in srgb, var(--maker-accent) 18%, transparent)");
  });
});
