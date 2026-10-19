"""Exercise measured browser geometry through the generated native contract."""
import importlib.util
import json
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('visual_compile', Path(__file__).parents[1]/'tools/compile_manifest.py')
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


def test_measured_canvas_and_hit_rect_survive_compilation(tmp_path):
    project = {'name':'Visual Effect','plugin_kind':'effect','interface':{'canvas_width':0,'canvas_height':0,
               'controls':[{'id':'level','kind':'knob','x':50,'y':50}]}}
    source = tmp_path/'project.json'
    source.write_text(json.dumps(project))
    assets = tmp_path/'assets'
    assets.mkdir()
    rect = dict(x=12,y=34,width=112,height=122)
    hit = dict(x=36.25,y=58.5,width=64,height=74)
    (assets/'visual_manifest.json').write_text(json.dumps({'version':1,'width':1024,'height':460,
        'controls':[dict(file='visual_control_0.png',rect=rect,hit=hit,frames=101,columns=16)],'keys':[]}))
    compiler.compile_manifest(source,tmp_path/'NativeProject.h')
    header = (tmp_path/'NativeProject.h').read_text()
    assert 'kCanvasWidth = 1024;' in header
    assert 'kCanvasHeight = 460;' in header
    assert 'VisualControl{"visual_control_0.png", 12.0f, 34.0f, 112.0f, 122.0f, 36.25f, 58.5f, 64.0f, 74.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 101, 16}' in header
    assert 'kVisualBackdrop = "visual_backdrop.png"' in header


def test_incomplete_capture_cannot_silently_fall_back(tmp_path):
    source = tmp_path/'project.json'
    source.write_text(json.dumps({'name':'Visual Effect','plugin_kind':'effect','interface':{'controls':[{'kind':'knob'}]}}))
    (tmp_path/'assets').mkdir()
    (tmp_path/'assets/visual_manifest.json').write_text(json.dumps({'version':1,'controls':[]}))
    with pytest.raises(SystemExit, match='control count mismatch'):
        compiler.compile_manifest(source,tmp_path/'NativeProject.h')
