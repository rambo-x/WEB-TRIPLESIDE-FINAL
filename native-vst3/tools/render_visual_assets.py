#!/usr/bin/env python3
"""Bake the real VST Maker DOM into native sprites and measured hit geometry.

Requires playwright + Pillow and a Chromium installation (or --browser).
Writes only into an already prepared build's generated/assets directory.
"""
import argparse
import hashlib
import io
import json
import math
import sys
import traceback
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


TRANSIENT_EXIT_CODE = 75
SUPPORTED_CONTROL_KINDS = {
    'knob', 'fader', 'vu_meter', 'gain_meter', 'keyboard', 'pad', 'button',
    'mute', 'solo', 'visual', 'text', 'image', 'panel_button', 'spectrum', 'indicator',
    'output_selector', 'solo_mute',
}
TRANSIENT_PLAYWRIGHT_MARKERS = (
    'browser has been closed',
    'browser closed',
    'browser crashed',
    'connection closed',
    'connection reset',
    'econnreset',
    'net::err_',
    'page crashed',
    'socket hang up',
    'target page, context or browser has been closed',
)


def is_transient_capture_error(error):
    """Only classify browser/network availability failures as retryable."""
    if isinstance(error, PlaywrightTimeoutError):
        return True
    if not isinstance(error, PlaywrightError):
        return False
    message = str(error).lower()
    return any(marker in message for marker in TRANSIENT_PLAYWRIGHT_MARKERS)


def clear_visual_capture_outputs(assets):
    """Remove only files owned by this capture/verification stage."""
    patterns = (
        'visual_manifest.json',
        'visual_reference*.png',
        'visual_backdrop.png',
        'visual_control_*.png',
        'visual_keys_*.png',
        'visual_panel_reference_*.png',
        'visual_panel_backdrop_*.png',
        'visual_panel_recomposed_*.png',
        'visual_panel_difference_*.png',
        'visual_panel_comparison_*.json',
        'visual_recomposed*.png',
        'visual_difference*.png',
        'visual_comparison*.json',
    )
    for pattern in patterns:
        for path in assets.glob(pattern):
            path.unlink()


def bake_context_delta(context, backdrop):
    """Store exact backdrop-dependent pixels while leaving unchanged pixels clear."""
    context = context.convert('RGBA')
    backdrop = backdrop.convert('RGBA')
    difference = ImageChops.difference(context, backdrop)
    red, green, blue, alpha = difference.split()
    changed = ImageChops.lighter(ImageChops.lighter(red, green), ImageChops.lighter(blue, alpha))
    mask = changed.point(lambda value: 255 if value else 0)
    result = context.copy()
    result.putalpha(mask)
    return result


def bounds(rect, padding, width, height):
    x, y = max(0, math.floor(rect['x'] - padding)), max(0, math.floor(rect['y'] - padding))
    right, bottom = min(width, math.ceil(rect['x'] + rect['width'] + padding)), min(height, math.ceil(rect['y'] + rect['height'] + padding))
    return dict(x=x, y=y, width=max(1, right-x), height=max(1, bottom-y))


def hidden_prism_context(control, controls):
    if control.get('prism_context') not in {'frequency', 'gain', 'q'}:
        return False
    owner = str(control.get('prism_owner_id') or '')
    analyzer = next((item for item in controls if str(item.get('id') or '') == owner), None)
    return not analyzer or analyzer.get('prism_control_mode') != 'contextual'


def control_frame_count(kind, spec):
    """Return the exact number of visual states needed by a control atlas."""
    if kind == 'output_selector':
        return 2  # Master plus the control's bound sampler output.
    if kind in {'keyboard', 'visual', 'text', 'image', 'spectrum', 'solo_mute'}:
        # The paired buttons are drawn from live group solo/mute parameters by
        # NativeView; the capture only supplies their shared idle backdrop.
        return 1
    if kind in {'button', 'mute', 'solo', 'pad', 'panel_button', 'indicator'}:
        return 2
    return 101


def render(spec_path, url, browser=None):
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    ui = spec['interface']
    width, height = max(320, ui.get('canvas_width') or 1024), max(320, ui.get('canvas_height') or 460)
    controls = ui.get('controls', [])
    visual_mode = (spec.get('visual_contract') or {}).get('mode')
    if visual_mode is None:  # Backward compatibility for queued pre-contract specs.
        visual_mode = 'native_live' if spec.get('dsp_profile') == 'prism_eq' else 'shared_preview'
    if visual_mode != 'shared_preview' or any(c['kind'] not in SUPPORTED_CONTROL_KINDS for c in controls):
        raise ValueError('This project contains a component not supported by the visual asset contract')
    assets = spec_path.parent / 'assets'
    assets.mkdir(exist_ok=True)
    clear_visual_capture_outputs(assets)
    manifest = dict(version=1, width=width, height=height, controls=[], keys=[], panels=[],
                    spec_sha256=hashlib.sha256(spec_path.read_bytes()).hexdigest())
    with sync_playwright() as p:
        launch = dict(headless=True)
        if browser:
            launch['executable_path'] = browser
        with p.chromium.launch(**launch) as chromium:
            page = chromium.new_page(viewport=dict(width=width+64, height=height+64), device_scale_factor=1)
            page.goto(url, wait_until='networkidle', timeout=60000)
            page.wait_for_function('window.__vstVisual?.version === 1')
            manifest['browser'] = chromium.version
            manifest['renderer_scripts'] = page.locator('script[src]').evaluate_all('es => es.map(e => e.src)')
            manifest['renderer_styles'] = page.locator('link[rel=stylesheet]').evaluate_all('es => es.map(e => e.href)')
            page.add_style_tag(content='html { background: transparent !important; }')
            # Use the downloaded, validated background. Never depend on an expiring URL.
            bg = ui.get('background', {})
            if bg.get('url'):
                files = list(assets.glob('ui_background.*'))
                if not files:
                    raise ValueError('Normalized background is missing')
                import base64
                mime = {'.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg'}[files[0].suffix]
                bg['url'] = f'data:{mime};base64,' + base64.b64encode(files[0].read_bytes()).decode()
            page.evaluate('(spec) => window.__vstVisual.setSpec(spec)', spec)
            page.evaluate('async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); }')
            # CSS background images also need an explicit decode barrier.
            page.evaluate(r'''async () => { await Promise.all([...document.querySelectorAll('.maker-plugin-canvas, .maker-plugin-canvas *')].map(async e => {
                const bg = getComputedStyle(e).backgroundImage;
                for (const m of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) { const i=new Image(); i.src=m[1]; await i.decode(); }
            })); }''')
            canvas = page.locator('.maker-plugin-canvas')
            box = canvas.bounding_box()
            if box != dict(x=0, y=0, width=width, height=height):
                raise ValueError(f'Canvas geometry differs from build specification: {box}')
            clip = dict(x=0, y=0, width=width, height=height)
            page.mouse.move(width+30, height+30)
            page.screenshot(path=str(assets/'visual_reference.png'), clip=clip, omit_background=True)
            # An independent live-DOM reference exercises a parameter endpoint and
            # simultaneous white/black notes, not just the initial idle frame.
            changed = next((c for c in controls if not c.get('parent_panel_id') and c.get('component_variant') == 'stomp-footswitch'), None)
            changed = changed or next((c for c in controls if not c.get('parent_panel_id') and c['kind'] in {'knob','fader','vu_meter','gain_meter'}), None)
            active_pitches = [48, 52, 55, 61]
            if changed:
                page.evaluate('(f) => window.__vstVisual.setFrame(f)', dict(id=changed['id'],value=100))
            page.locator('[data-vst-pitch]').evaluate_all('(es, pitches) => es.forEach(e => e.classList.toggle("is-pressed", pitches.includes(Number(e.dataset.vstPitch))))', active_pitches)
            page.screenshot(path=str(assets/'visual_reference_active.png'), clip=clip, omit_background=True)
            manifest['active_check'] = dict(id=changed['id'] if changed else '', value=100, pitches=active_pitches)
            page.locator('[data-vst-pitch]').evaluate_all('es => es.forEach(e => e.classList.remove("is-pressed"))')
            page.evaluate('window.__vstVisual.setFrame({})')
            # Panel children are only visible while their parent is open. Save
            # an independent open-panel reference plus the same scene with its
            # child controls hidden, so the verifier can recompose each panel
            # without contaminating the closed-canvas reference below.
            page.add_style_tag(content='body.vst-panel-static .maker-canvas-control.is-panel-child { visibility: hidden !important; }')
            parent_panel_ids = list(dict.fromkeys(
                str(control.get('parent_panel_id') or '')
                for control in controls if control.get('parent_panel_id')
            ))
            for panel_index, panel_id in enumerate(parent_panel_ids):
                page.evaluate('(f) => window.__vstVisual.setFrame(f)', dict(panelId=panel_id))
                page.wait_for_function(
                    '(id) => [...document.querySelectorAll("[data-vst-control]")].some(e => e.dataset.vstControl === id)',
                    arg=next(str(control.get('id') or '') for control in controls if str(control.get('parent_panel_id') or '') == panel_id),
                )
                reference_file = f'visual_panel_reference_{panel_index}.png'
                backdrop_file = f'visual_panel_backdrop_{panel_index}.png'
                page.screenshot(path=str(assets/reference_file), clip=clip, omit_background=True)
                page.evaluate("document.body.classList.add('vst-panel-static')")
                page.screenshot(path=str(assets/backdrop_file), clip=clip, omit_background=True)
                page.evaluate("document.body.classList.remove('vst-panel-static')")
                manifest['panels'].append(dict(
                    id=panel_id, reference=reference_file, backdrop=backdrop_file,
                ))
            page.evaluate('window.__vstVisual.setFrame({})')
            page.evaluate("document.body.classList.add('vst-static')")
            page.screenshot(path=str(assets/'visual_backdrop.png'), clip=clip, omit_background=True)
            page.evaluate("document.body.classList.replace('vst-static','vst-layer')")
            # A target with backdrop-filter must see the real backdrop while it
            # is rasterized. This late rule reveals only that target in the
            # otherwise-static scene; normal controls keep the transparent path.
            page.add_style_tag(content='.vst-visual-render.vst-static .maker-canvas-control.vst-target { visibility: visible; }')
            backdrop_image = Image.open(assets/'visual_backdrop.png').convert('RGBA')
            def capture(rect, with_backdrop=False):
                if with_backdrop:
                    page.evaluate("document.body.classList.replace('vst-layer','vst-static')")
                try:
                    captured = Image.open(io.BytesIO(page.screenshot(clip=rect, omit_background=True))).convert('RGBA')
                finally:
                    if with_backdrop:
                        page.evaluate("document.body.classList.replace('vst-static','vst-layer')")
                if not with_backdrop:
                    return captured
                backdrop = backdrop_image.crop((rect['x'], rect['y'], rect['x']+rect['width'], rect['y']+rect['height']))
                return bake_context_delta(captured, backdrop)

            for index, control in enumerate(controls):
                parent_panel_id = str(control.get('parent_panel_id') or '')
                page.evaluate('(f) => window.__vstVisual.setFrame(f)', dict(
                    panelId=parent_panel_id or None,
                    id=control['id'],
                    value=control.get('value', 0),
                ))
                if parent_panel_id:
                    page.wait_for_function(
                        '(id) => [...document.querySelectorAll("[data-vst-control]")].some(e => e.dataset.vstControl === id)',
                        arg=str(control.get('id') or ''),
                    )
                dom_index = page.locator('[data-vst-control]').evaluate_all(
                    '(elements, id) => elements.findIndex(element => element.dataset.vstControl === id)',
                    str(control.get('id') or ''),
                )
                if dom_index < 0:
                    raise ValueError(f'Control is missing from the visual renderer: {control.get("id")}')
                element = page.locator('[data-vst-control]').nth(dom_index)
                element.evaluate("e => e.classList.add('vst-target')")
                hit = element.bounding_box()
                rect = bounds(hit, 24, width, height)
                kind = control['kind']
                if hidden_prism_context(control, controls):
                    filename = f'visual_control_{index}.png'
                    Image.new('RGBA', (rect['width'], rect['height']), (0, 0, 0, 0)).save(assets/filename)
                    manifest['controls'].append(dict(file=filename, rect=rect, hit=hit, frames=1, columns=1))
                    element.evaluate("e => e.classList.remove('vst-target')")
                    print(f'Keeping hidden Prism context layout {index+1}/{len(controls)}: {kind}', flush=True)
                    continue
                uses_backdrop = element.evaluate("""e => [e, ...e.querySelectorAll('*')].some(node => {
                    const style = getComputedStyle(node);
                    return (style.backdropFilter && style.backdropFilter !== 'none') ||
                           (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none');
                })""")
                meter_channels = []
                meter_mode = control.get('meter_mode') or ('stereo' if kind == 'gain_meter' else 'mono')
                if kind == 'fader' and control.get('fader_meter_enabled', True):
                    inline_meter = element.locator('.maker-fader-inline-meter .maker-gain-meter__channels > i')
                    if inline_meter.count():
                        meter_hit = inline_meter.first.bounding_box()
                        if meter_hit is None:
                            raise ValueError(f'Fader meter geometry is missing: {control.get("id")}')
                        meter_channels = [meter_hit]
                if kind in {'gain_meter', 'vu_meter'} and meter_mode == 'stereo':
                    channel_selector = (
                        '.maker-filmstrip-meter-group.is-stereo .maker-filmstrip-meter'
                        if element.locator('.maker-filmstrip-meter-group.is-stereo').count()
                        else '.maker-vu-meter-group.is-stereo .maker-vu-meter'
                        if kind == 'vu_meter'
                        else '.maker-gain-meter.is-stereo .maker-gain-meter__channels > i'
                    )
                    channel_elements = element.locator(channel_selector)
                    meter_channels = [channel_elements.nth(channel).bounding_box() for channel in range(min(2, channel_elements.count()))]
                    if len(meter_channels) != 2 or any(channel is None for channel in meter_channels):
                        raise ValueError(f'Stereo meter channel geometry is missing: {control.get("id")}')
                print(f'Capturing shared visual {index+1}/{len(controls)}: {kind}', flush=True)
                # Spectrum/vectorscope pixels stay live in NativeView. Capture
                # one browser frame here to preserve exact measured geometry
                # and to keep the static composition verifier authoritative.
                frames = control_frame_count(kind, spec)
                columns = min(frames, max(1, 4096 // rect['width']))
                atlas = Image.new('RGBA', (rect['width']*columns, rect['height']*math.ceil(frames/columns)))
                if max(atlas.size) > 8192:
                    raise ValueError('Visual atlas exceeds 8192 pixels; reduce component size')
                if kind == 'keyboard':
                    element.locator('[data-vst-pitch]').evaluate_all("es => es.forEach(e => e.style.visibility='hidden')")
                for frame in range(frames):
                    value = frame * 100 / max(1, frames-1)
                    state = dict(id=control['id'], value=value, panelId=parent_panel_id or None)
                    if kind == 'pad' and frame:
                        state['pitch'] = control.get('note_pitch', 60)
                    page.evaluate('(f) => window.__vstVisual.setFrame(f)', state)
                    atlas.paste(capture(rect, uses_backdrop), ((frame%columns)*rect['width'], (frame//columns)*rect['height']))
                filename = f'visual_control_{index}.png'
                atlas.save(assets/filename)
                manifest['controls'].append(dict(
                    file=filename, rect=rect, hit=hit, frames=frames, columns=columns,
                    meter_channels=meter_channels,
                ))
                if kind == 'keyboard':
                    keys = element.locator('[data-vst-pitch]')
                    page.evaluate("document.body.classList.add('vst-key')")
                    key_images = []
                    key_entries = []
                    for key_index in range(keys.count()):
                        key = keys.nth(key_index)
                        pitch = int(key.get_attribute('data-vst-pitch'))
                        key_hit = key.bounding_box()
                        key_rect = bounds(key_hit, 8, width, height)
                        # React replaces className when pressed state changes.
                        # An inline visibility override survives that update.
                        key.evaluate("e => { e.style.visibility='visible'; }")
                        for active in (False, True):
                            page.evaluate('(f) => window.__vstVisual.setFrame(f)', dict(pitch=pitch) if active else {})
                            key_images.append(capture(key_rect))
                        key_entries.append(dict(
                            control=index, pitch=pitch, rect=key_rect, hit=key_hit,
                            frame=key_index*2, source_width=key_images[-1].width,
                            source_height=key_images[-1].height,
                        ))
                        key.evaluate("e => { e.style.visibility='hidden'; }")
                    cell_w, cell_h = max(i.width for i in key_images), max(i.height for i in key_images)
                    cols = min(16, max(1, 4096//cell_w))
                    key_atlas = Image.new('RGBA', (cell_w*cols, cell_h*math.ceil(len(key_images)/cols)))
                    for k, img in enumerate(key_images):
                        key_atlas.paste(img, ((k%cols)*cell_w, (k//cols)*cell_h))
                    filename = f'visual_keys_{index}.png'
                    key_atlas.save(assets/filename)
                    for entry in key_entries:
                        manifest['keys'].append(dict(**entry, file=filename, columns=cols, cell_width=cell_w, cell_height=cell_h))
                    page.evaluate("document.body.classList.remove('vst-key')")
                element.evaluate("e => e.classList.remove('vst-target')")
            manifest['reference_sha256'] = hashlib.sha256((assets/'visual_reference.png').read_bytes()).hexdigest()
    (assets/'visual_manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('spec', type=Path)
    parser.add_argument('--url', required=True)
    parser.add_argument('--browser')
    args = parser.parse_args()
    try:
        render(args.spec, args.url, args.browser)
    except Exception as error:
        traceback.print_exc()
        if is_transient_capture_error(error):
            print('TRIPLESIDE_VISUAL_CAPTURE_TRANSIENT=1', file=sys.stderr, flush=True)
            return TRANSIENT_EXIT_CODE
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
