import importlib.util
import json
import tempfile
import unittest
import wave
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "export_project.py"
MODULE_SPEC = importlib.util.spec_from_file_location("tripleside_export_project", MODULE_PATH)
export_project = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC.loader is not None
MODULE_SPEC.loader.exec_module(export_project)


def project_spec(sample_name="Piano C3.wav"):
    return {
        "schema_version": "0.3-preview",
        "name": "Studio Piano",
        "instrument": {"polyphony": 32},
        "samples": [{"id": "sample-1", "name": sample_name, "bytes": 64}],
        "sampler_map": [{"id": "zone-1", "sampleId": "sample-1", "rootPitch": 60}],
        "interface": {"accent_color": "#f43f5e", "controls": []},
        "sample_packaging": {"mode": "external_audio", "monolith": False},
        "build": {"company_name": "TripleSide Studio", "version": "1.2.3"},
    }


class ExportProjectTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.samples = self.root / "samples"
        self.samples.mkdir()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_wave(self, name="Piano C3.wav"):
        path = self.samples / name
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(44100)
            audio.writeframes(b"\0\0" * 64)
        return path

    def write_spec(self, spec):
        path = self.root / "project.json"
        path.write_text(json.dumps(spec), encoding="utf-8")
        return path

    def test_prepare_embeds_portable_audio_and_metadata(self):
        self.write_wave()
        output = self.root / "output"
        generated = export_project.prepare(self.write_spec(project_spec()), self.samples, output, None, None)

        normalized = json.loads((generated / "project.json").read_text(encoding="utf-8"))
        manifest = json.loads((output / "export-manifest.json").read_text(encoding="utf-8"))
        config = (generated / "ProjectConfig.cmake").read_text(encoding="utf-8")

        self.assertEqual(normalized["samples"][0]["resource_name"], "sample_000_wav")
        self.assertTrue((generated / "assets" / "sample_000.wav").is_file())
        self.assertEqual(manifest["product_name"], "Studio Piano")
        self.assertEqual(manifest["version"], "1.2.3")
        self.assertEqual(manifest["sample_count"], 1)
        self.assertEqual(manifest["zone_count"], 1)
        self.assertRegex(manifest["manufacturer_code"], r"^T[a-z]{3}$")
        self.assertRegex(manifest["plugin_code"], r"^P[a-z]{3}$")
        self.assertIn('set(TS_PRODUCT_NAME "Studio Piano")', config)

    def test_prepare_embeds_custom_cabinet_ir_separately_from_samples(self):
        self.write_wave()
        self.write_wave("cabinet_ir_000.wav")
        spec = project_spec()
        spec["dsp_graph"] = {
            "version": 2, "mode": "ordered_rack", "source": "project",
            "modules": [{"id": "cab", "type": "cabinet_ir", "name": "Cabinet"}],
        }
        spec["impulse_responses"] = [{
            "id": "ir-1", "moduleId": "cab", "name": "cabinet_ir_000.wav",
            "trimStart": 0, "trimEnd": 1, "phaseMs": 0,
        }]

        generated = export_project.prepare(
            self.write_spec(spec), self.samples, self.root / "output", None, None
        )
        normalized = json.loads((generated / "project.json").read_text(encoding="utf-8"))
        manifest = json.loads((self.root / "output" / "export-manifest.json").read_text(encoding="utf-8"))

        self.assertEqual(normalized["impulse_responses"][0]["resource_name"], "cabinet_ir_000.wav")
        self.assertTrue((generated / "assets" / "cabinet_ir_000.wav").is_file())
        self.assertEqual(manifest["impulse_response_count"], 1)

    def test_rejects_proprietary_sample_container(self):
        spec = project_spec("Piano C3.ch1")
        with self.assertRaisesRegex(SystemExit, "unsupported sample format"):
            export_project.prepare(self.write_spec(spec), self.samples, self.root / "output", None, None)

    def test_rejects_unknown_mapping_sample(self):
        spec = project_spec()
        spec["sampler_map"][0]["sampleId"] = "missing"
        with self.assertRaisesRegex(SystemExit, "existing sample"):
            export_project.validate_spec(spec)

    def test_rejects_duplicate_sample_ids(self):
        spec = project_spec()
        spec["samples"].append({"id": "sample-1", "name": "Duplicate.wav", "bytes": 64})
        with self.assertRaisesRegex(SystemExit, "sample ids must be unique"):
            export_project.validate_spec(spec)

    def test_rejects_invalid_zone_ranges(self):
        spec = project_spec()
        spec["sampler_map"][0].update({"lowPitch": 72, "rootPitch": 60, "highPitch": 80})
        with self.assertRaisesRegex(SystemExit, "valid MIDI key range"):
            export_project.validate_spec(spec)

    def test_rejects_loop_outside_trim(self):
        spec = project_spec()
        spec["sampler_map"][0].update({
            "sampleStart": 0.2,
            "sampleEnd": 0.8,
            "loopEnabled": True,
            "loopStart": 0.1,
            "loopEnd": 0.7,
        })
        with self.assertRaisesRegex(SystemExit, "loop must stay inside"):
            export_project.validate_spec(spec)

    def test_accepts_multiple_unique_choke_targets_and_rejects_invalid_values(self):
        spec = project_spec()
        spec["sampler_map"][0]["chokeTargetPitches"] = [44, 46, 48]
        export_project.validate_spec(spec)

        spec["sampler_map"][0]["chokeTargetPitches"] = [44, 44]
        with self.assertRaisesRegex(SystemExit, "must be unique"):
            export_project.validate_spec(spec)

        spec["sampler_map"][0]["chokeTargetPitches"] = [128]
        with self.assertRaisesRegex(SystemExit, "MIDI pitch"):
            export_project.validate_spec(spec)

    def test_codes_are_stable_and_namespaced(self):
        self.assertEqual(export_project.four_char_code("TripleSide Studio", "T"), export_project.four_char_code("TripleSide Studio", "T"))
        self.assertNotEqual(export_project.four_char_code("Vendor A", "P"), export_project.four_char_code("Vendor B", "P"))

    def test_prepare_embeds_custom_background(self):
        self.write_wave()
        spec = project_spec()
        spec["interface"]["background"] = {
            "url": "https://cdn.example.test/panel.png",
            "name": "panel.png",
            "fit": "cover",
            "opacity": 80,
        }
        background = self.root / "panel-upload"
        background.write_bytes(b"\x89PNG\r\n\x1a\n" + b"test-image")
        output = self.root / "output"

        generated = export_project.prepare(
            self.write_spec(spec), self.samples, output, None, None, background
        )
        normalized = json.loads((generated / "project.json").read_text(encoding="utf-8"))
        manifest = json.loads((output / "export-manifest.json").read_text(encoding="utf-8"))

        self.assertEqual(normalized["interface"]["background"]["resource_name"], "ui_background_png")
        self.assertTrue((generated / "assets" / "ui_background.png").is_file())
        self.assertTrue(manifest["background_embedded"])

    def test_large_project_json_is_only_embedded_as_binary_data(self):
        self.write_wave()
        spec = project_spec()
        spec["interface"]["controls"] = [{"label": "Nada panjang ü" * 80}] * 200

        generated = export_project.prepare(
            self.write_spec(spec), self.samples, self.root / "output", None, None
        )
        config = (generated / "ProjectConfig.cmake").read_text(encoding="utf-8")

        self.assertGreater((generated / "project.json").stat().st_size, 65_535)
        self.assertIn("project.json", config)
        self.assertFalse((generated / "ProjectData.h").exists())

    def test_prepare_rejects_silent_background_omission(self):
        self.write_wave()
        spec = project_spec()
        spec["interface"]["background"] = {"url": "https://cdn.example.test/panel.png"}
        with self.assertRaisesRegex(SystemExit, "no --background-image"):
            export_project.prepare(self.write_spec(spec), self.samples, self.root / "output", None, None)


if __name__ == "__main__":
    unittest.main()
