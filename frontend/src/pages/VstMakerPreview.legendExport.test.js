import fs from "fs";
import path from "path";

describe("Legend Hardware native export gate", () => {
  const source = fs.readFileSync(path.join(__dirname, "VstMakerPreview.jsx"), "utf8");

  test("keeps export available after browser and native DSP are synchronized", () => {
    expect(source).not.toContain("hasUnsyncedLegendHardware");
    expect(source).not.toContain("Legend Hardware masih tahap browser preview");
    expect(source).not.toContain("Browser preview · native menyusul");
    expect(source).toContain("Browser + native sinkron");
    expect(source).toContain("const enqueuePlatformBuild = async (targetPlatform) => {");
    expect(source).toContain("const requestPlatformBuild = async (targetPlatform) => {");
  });
});
