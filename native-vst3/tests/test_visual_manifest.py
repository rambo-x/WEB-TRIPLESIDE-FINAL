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
    assert 'VisualControl{"visual_control_0.png", 12.0f, 34.0f, 112.0f, 122.0f, 36.25f, 58.5f, 64.0f, 74.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 101, 16}' in header
    assert 'kVisualBackdrop = "visual_backdrop.png"' in header


def test_measured_fader_meter_track_survives_compilation(tmp_path):
    project = {'name':'Metered Fader','plugin_kind':'effect','interface':{'controls':[{
        'id':'level','kind':'fader','x':50,'y':50,'fader_meter_enabled':True,
    }]}}
    source = tmp_path/'project.json'
    source.write_text(json.dumps(project))
    assets = tmp_path/'assets'
    assets.mkdir()
    rect = dict(x=12,y=34,width=112,height=122)
    hit = dict(x=36,y=58,width=64,height=74)
    meter = dict(x=91,y=76,width=10,height=56)
    (assets/'visual_manifest.json').write_text(json.dumps({'version':1,'width':1024,'height':460,
        'controls':[dict(file='visual_control_0.png',rect=rect,hit=hit,meter_channels=[meter],frames=101,columns=16)],'keys':[]}))
    compiler.compile_manifest(source,tmp_path/'NativeProject.h')
    header = (tmp_path/'NativeProject.h').read_text()
    assert '91.0f, 76.0f, 10.0f, 56.0f' in header


def test_keyboard_key_source_size_survives_atlas_compilation(tmp_path):
    project = {'name':'Visual Instrument','plugin_kind':'effect','interface':{
        'controls':[{'id':'keys','kind':'keyboard','x':50,'y':50,'width':680,'height':150,'key_count':49}]}}
    source = tmp_path/'project.json'
    source.write_text(json.dumps(project))
    assets = tmp_path/'assets'
    assets.mkdir()
    rect = dict(x=100,y=200,width=30,height=94)
    hit = dict(x=108,y=208,width=14,height=78)
    (assets/'visual_manifest.json').write_text(json.dumps({'version':1,'width':1024,'height':460,
        'controls':[dict(file='visual_control_0.png',rect=rect,hit=hit,frames=1,columns=1)],
        'keys':[dict(file='visual_keys_0.png',control=0,pitch=37,rect=rect,hit=hit,frame=2,
                     columns=16,cell_width=38,cell_height=142,source_width=30,source_height=94)]}))
    compiler.compile_manifest(source,tmp_path/'NativeProject.h')
    header = (tmp_path/'NativeProject.h').read_text()
    assert 'VisualKey{"visual_keys_0.png", 0, 37, 100.0f, 200.0f, 30.0f, 94.0f, 108.0f, 208.0f, 14.0f, 78.0f, 2, 16, 38, 142, 30, 94}' in header


def test_incomplete_capture_cannot_silently_fall_back(tmp_path):
    source = tmp_path/'project.json'
    source.write_text(json.dumps({'name':'Visual Effect','plugin_kind':'effect','interface':{'controls':[{'kind':'knob'}]}}))
    (tmp_path/'assets').mkdir()
    (tmp_path/'assets/visual_manifest.json').write_text(json.dumps({'version':1,'controls':[]}))
    with pytest.raises(SystemExit, match='control count mismatch'):
        compiler.compile_manifest(source,tmp_path/'NativeProject.h')
