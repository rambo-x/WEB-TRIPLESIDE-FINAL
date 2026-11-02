import fs from "fs";
import path from "path";

describe("Preset Browser user preset management", () => {
  const source = fs.readFileSync(path.join(__dirname, "VstMakerPreview.jsx"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "VstMakerPreview.css"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "VstVisualRender.jsx"), "utf8");

  test("keeps factory presets immutable and exposes an explicit bilingual user update action", () => {
    expect(source).toContain('preset.category !== "factory" && <div className="maker-panel-preset-row__actions">');
    expect(source).toContain('english ? "Update" : "Perbarui"');
    expect(source).toContain('item.id === preset.id ? capturePreset(preset.name, preset.id) : item');
    expect(source).toContain('presets.filter((item) => item.id !== preset.id)');
    expect(source).toContain('if (hasPresetName(presets, name))');
  });

  test("persists the active UI language into projects and visual capture", () => {
    expect(source).toContain('ui_language: activeLocale === "en" ? "en" : "id"');
    expect(source).toContain('uiLanguage: saved.ui_language === "en" ? "en" : "id"');
    expect(source).toContain('toProjectPayload(projectToSave, currentSamples, locale)');
    expect(renderer).toContain('uiLanguage={spec.ui_language === "en" ? "en" : "id"}');
  });

  test("uses clear update and trash buttons with pointer feedback", () => {
    expect(styles).toContain(".maker-panel-preset-row__update");
    expect(styles).toContain(".maker-panel-preset-row__delete");
    expect(styles).toContain("cursor: pointer");
    expect(source).toContain("<Trash2 size={14} />");
  });
});
