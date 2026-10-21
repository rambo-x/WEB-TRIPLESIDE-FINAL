#!/usr/bin/env python3
"""Recompose native sprite coordinates and compare against the actual browser.

This verifies the export/geometry contract, not Windows GPU rasterization.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

MIN_PERCENT_WITHIN_8 = 99.8
MAX_MEAN_ABSOLUTE_RGBA = 0.5


def comparison(reference, result, root, recomposed_name, difference_name, comparison_name):
    diff = ImageChops.difference(reference, result)
    result.save(root/recomposed_name)
    diff.save(root/difference_name)
    mean = ImageStat.Stat(diff).mean
    red, green, blue, _ = diff.split()
    errors = sum(ImageChops.lighter(ImageChops.lighter(red,green),blue).histogram()[9:])
    report = dict(mean_absolute_rgba=mean, pixels_over_8=errors, total_pixels=result.width*result.height,
                  percent_within_8=100*(1-errors/(result.width*result.height)))
    (root/comparison_name).write_text(json.dumps(report,indent=2)+'\n')
    return report


def verify(spec_path, active=False):
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    root = spec_path.parent / 'assets'
    manifest = json.loads((root/'visual_manifest.json').read_text(encoding='utf-8'))
    state = manifest.get('active_check', {}) if active else {}
    suffix = '_active' if active else ''
    result = Image.open(root/'visual_backdrop.png').convert('RGBA')
    cache = {}

    def paste(item, frame, cell_width=None, cell_height=None):
        file = item['file']
        if file not in cache:
            cache[file] = Image.open(root/file).convert('RGBA')
        r = item['rect']
        w, h = cell_width or r['width'], cell_height or r['height']
        x, y = (frame % item['columns'])*w, (frame // item['columns'])*h
        tile = cache[file].crop((x,y,x+r['width'],y+r['height']))
        result.alpha_composite(tile, (r['x'], r['y']))

    for i, item in enumerate(manifest['controls']):
        control = spec['interface']['controls'][i]
        if control.get('parent_panel_id'):
            continue
        value = 0 if control['kind'] in {'gain_meter','vu_meter','pad','keyboard','visual','text'} else control.get('value',50)
        if control.get('id') == state.get('id'):
            value = state['value']
        paste(item, round(value/100*(item['frames']-1)))
        for key in manifest['keys']:
            if key['control'] == i:
                paste(key, key['frame'] + (key['pitch'] in state.get('pitches', [])), key['cell_width'], key['cell_height'])
    reference = Image.open(root/f'visual_reference{suffix}.png').convert('RGBA')
    return comparison(reference, result, root, f'visual_recomposed{suffix}.png',
                      f'visual_difference{suffix}.png', f'visual_comparison{suffix}.json')


def verify_panels(spec_path):
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    root = spec_path.parent / 'assets'
    manifest = json.loads((root/'visual_manifest.json').read_text(encoding='utf-8'))
    cache = {}
    reports = []
    for panel_index, panel in enumerate(manifest.get('panels', [])):
        result = Image.open(root/panel['backdrop']).convert('RGBA')
        for control_index, item in enumerate(manifest['controls']):
            control = spec['interface']['controls'][control_index]
            if str(control.get('parent_panel_id') or '') != str(panel['id']):
                continue
            file = item['file']
            if file not in cache:
                cache[file] = Image.open(root/file).convert('RGBA')
            value = 0 if control['kind'] in {'gain_meter','vu_meter','pad','keyboard','visual','text'} else control.get('value',50)
            frame = round(value/100*(item['frames']-1))
            rect = item['rect']
            x = (frame % item['columns']) * rect['width']
            y = (frame // item['columns']) * rect['height']
            tile = cache[file].crop((x, y, x+rect['width'], y+rect['height']))
            result.alpha_composite(tile, (rect['x'], rect['y']))
        reference = Image.open(root/panel['reference']).convert('RGBA')
        reports.append(comparison(
            reference, result, root,
            f'visual_panel_recomposed_{panel_index}.png',
            f'visual_panel_difference_{panel_index}.png',
            f'visual_panel_comparison_{panel_index}.json',
        ))
    return reports


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('spec', type=Path)
    args = parser.parse_args()
    report = verify(args.spec)
    print(json.dumps(report,indent=2))
    if report['percent_within_8'] < MIN_PERCENT_WITHIN_8 or max(report['mean_absolute_rgba']) > MAX_MEAN_ABSOLUTE_RGBA:
        raise SystemExit('Visual composition differs from browser reference beyond tolerance')
    for panel_index, panel_report in enumerate(verify_panels(args.spec)):
        print(f'Panel {panel_index}:', json.dumps(panel_report,indent=2))
        if panel_report['percent_within_8'] < MIN_PERCENT_WITHIN_8 or max(panel_report['mean_absolute_rgba']) > MAX_MEAN_ABSOLUTE_RGBA:
            raise SystemExit(f'Panel {panel_index} visual composition differs from browser reference beyond tolerance')
    if (args.spec.parent/'assets/visual_reference_active.png').exists():
        report = verify(args.spec, active=True)
        print('Active controls:', json.dumps(report,indent=2))
        if report['percent_within_8'] < MIN_PERCENT_WITHIN_8 or max(report['mean_absolute_rgba']) > MAX_MEAN_ABSOLUTE_RGBA:
            raise SystemExit('Active-state visual composition differs from browser reference beyond tolerance')
