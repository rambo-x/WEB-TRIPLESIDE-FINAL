const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src", "lib", "vstDspProcessor.js");
const outputPath = path.join(root, "public", "vst-dsp-worklet-v25.js");
const source = fs.readFileSync(sourcePath, "utf8");
const startMarker = "export const createNativeDspProcessorClass = ";
const endMarker = "\n\nexport const installNativeDspWorklet";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("Native DSP processor source markers were not found");
const expression = source.slice(start + startMarker.length, end).trim().replace(/;$/, "");
const generated = [
  "// Generated from src/lib/vstDspProcessor.js. Do not edit directly.",
  `const createNativeDspProcessorClass = ${expression};`,
  'registerProcessor("tripleside-native-dsp", createNativeDspProcessorClass(AudioWorkletProcessor, sampleRate));',
  "",
].join("\n");
fs.writeFileSync(outputPath, generated, "utf8");
console.log(`Generated ${path.relative(root, outputPath)}`);
