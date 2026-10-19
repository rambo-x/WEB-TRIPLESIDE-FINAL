#!/usr/bin/env python3
"""Compare a real VST3 HWND capture with the browser export reference."""
import argparse
import json
from PIL import Image, ImageChops, ImageStat
from pathlib import Path


def compare(reference_path, native_path, output):
    reference = Image.open(reference_path).convert('RGBA')
    expected = Image.new('RGBA', reference.size, (8,8,11,255))
    expected.alpha_composite(reference)
    actual = Image.open(native_path).convert('RGB')
    if actual.size != expected.size:
        raise ValueError(f'Canvas size mismatch: browser={expected.size}, native={actual.size}')
    diff = ImageChops.difference(expected.convert('RGB'), actual)
    r,g,b = diff.split()
    errors = sum(ImageChops.lighter(ImageChops.lighter(r,g),b).histogram()[9:])
    report = dict(mean_absolute_rgb=ImageStat.Stat(diff).mean, pixels_over_8=errors,
                  total_pixels=actual.width*actual.height,
                  percent_within_8=100*(1-errors/(actual.width*actual.height)))
    output.mkdir(parents=True, exist_ok=True)
    actual.save(output/'native-window.png')
    diff.save(output/'native-difference.png')
    (output/'native-comparison.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('reference',type=Path)
    parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report=compare(args.reference,args.capture,args.output)
    print(json.dumps(report,indent=2))
    if report['percent_within_8']<99.9 or max(report['mean_absolute_rgb'])>0.5:
        raise SystemExit('Native HWND rendering differs from browser reference beyond tolerance')
