"""
Keeps the trained generator warm in memory and draws on request.

The chat app talks to this over HTTP rather than spawning Python per image --
loading the checkpoint each time would add seconds to every drawing.
"""
import json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import UNet, Diffusion
from png import write_png
from nearest import nearest as nearest_neighbours

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
OUT_COLOR = os.path.join(HERE, 'out_color')
IMG = os.path.join(OUT, 'images')
os.makedirs(IMG, exist_ok=True)
PORT = int(os.environ.get('GEN_PORT', 4319))

def pick_device():
    """
    GPU when it's free, CPU while training holds it.

    Two processes both grabbing MPS contend badly on Apple Silicon -- it nearly
    froze the trainer during development. A single 28x28 sample is quick on CPU
    anyway, so yielding the GPU costs almost nothing.
    """
    forced = os.environ.get('GEN_DEVICE')
    if forced:
        return forced
    try:
        # Matches train.py and train_color.py alike -- naming a single script
        # here is how this regressed once already.
        busy = subprocess.run(['pgrep', '-f', 'gen/train'],
                              capture_output=True, text=True).stdout.strip()
        if busy:
            return 'cpu'
    except Exception:
        pass
    return 'mps' if torch.backends.mps.is_available() else 'cpu'


dev = pick_device()
_lock = threading.Lock()

# Two generators: monochrome line doodles, and 32x32 colour photographs. Colour
# covers far more subjects and reads as an image, so it is preferred when it can
# draw what was asked for.
# Until the colour model has had enough passes it outputs static, which is worse
# than a doodle -- so it stays out of the routing until it is actually usable.
COLOUR_MIN_EPOCHS = 20

_models = {
    'colour': {'dir': OUT_COLOR, 'model': None, 'classes': [], 'diff': None,
               'mtime': 0, 'shape': (3, 32, 32), 'colour': True, 'epochs': 0},
    'doodle': {'dir': OUT, 'model': None, 'classes': [], 'diff': None,
               'mtime': 0, 'shape': (1, 28, 28), 'colour': False, 'epochs': 0},
}


def load_if_newer(kind=None):
    """Picks up fresh checkpoints while training is still running."""
    any_ready = False
    for name, st in _models.items():
        if kind and name != kind:
            any_ready = any_ready or st['model'] is not None
            continue
        path = os.path.join(st['dir'], 'model.pt')
        if not os.path.exists(path):
            continue
        mtime = os.path.getmtime(path)
        if st['model'] is not None and mtime == st['mtime']:
            any_ready = True
            continue
        try:
            ck = torch.load(path, map_location=dev)
            m = UNet(len(ck['classes']), base=ck.get('base', 64),
                     in_ch=ck.get('in_ch', 1), attn=ck.get('attn', False)).to(dev)
            m.load_state_dict(ck['model'])
            m.eval()
            epochs = 0
            try:
                with open(os.path.join(st['dir'], 'log.json')) as f:
                    epochs = len(json.load(f).get('epochs', []))
            except Exception:
                pass
            st.update(model=m, classes=ck['classes'], diff=Diffusion(ck['T'], dev),
                      mtime=mtime, epochs=epochs)
            print(f'[gen] loaded {name} ({len(ck["classes"])} subjects, {epochs} epochs)', flush=True)
            any_ready = True
        except Exception as e:
            print(f'[gen] could not load {name}: {e}', flush=True)
    return any_ready


def usable(kind):
    st = _models[kind]
    if st['model'] is None:
        return False
    return kind != 'colour' or st['epochs'] >= COLOUR_MIN_EPOCHS


def find_subject(want):
    """Which model can draw this, preferring colour once it is usable."""
    want = want.strip().lower().replace('_', ' ')
    order = [k for k in ('colour', 'doodle') if usable(k)]
    for kind in order:
        norm = [c.replace('_', ' ') for c in _models[kind]['classes']]
        for i, c in enumerate(norm):
            if c == want:
                return kind, i
    for kind in order:
        norm = [c.replace('_', ' ') for c in _models[kind]['classes']]
        for i, c in enumerate(norm):
            if c in want or want in c:
                return kind, i
    return None, None


def all_subjects():
    seen = []
    for kind in [k for k in ('colour', 'doodle') if usable(k)]:
        for c in _models[kind]['classes']:
            c = c.replace('_', ' ')
            if c not in seen:
                seen.append(c)
    return sorted(seen)


def to_png(sample, path, scale=6, colour=False):
    """Upscales with nearest-neighbour so a tiny image is legible on screen."""
    a = ((sample.cpu().numpy() + 1) * 127.5).clip(0, 255).astype('uint8')
    rows = []
    if colour:
        a = a.transpose(1, 2, 0)                  # CHW -> HWC
        for r in a:
            row = bytearray()
            for px in r:
                row.extend(bytes(px) * scale)
            for _ in range(scale):
                rows.append(row)
        write_png(path, rows, colour=True)
    else:
        for r in a[0]:
            row = bytearray()
            for v in r:
                row.extend([255 - int(v)] * scale)   # invert: dark ink on white
            for _ in range(scale):
                rows.append(row)
        write_png(path, rows)


def draw(kind, label_idx, n, guidance, steps, capture=0):
    st = _models[kind]
    with _lock:
        labels = torch.full((n,), label_idx, device=dev, dtype=torch.long)
        return st['diff'].sample_ddim(st['model'], labels, len(st['classes']),
                                      guidance=guidance, steps=steps,
                                      capture=capture, shape=st['shape'])


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # the chat server already logs; this would double up

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/status':
            ready = load_if_newer()
            log = {}
            try:
                with open(os.path.join(OUT, 'log.json')) as f:
                    log = json.load(f)
            except Exception:
                pass
            colour_log = {}
            try:
                with open(os.path.join(OUT_COLOR, 'log.json')) as f:
                    colour_log = json.load(f)
            except Exception:
                pass
            return self._send(200, {
                'ready': ready,
                'classes': all_subjects(),
                'device': dev,
                'models': {
                    'colour': {'ready': usable('colour'),
                               'training': _models['colour']['model'] is not None and not usable('colour'),
                               'subjects': len(_models['colour']['classes']),
                               'epochs': len(colour_log.get('epochs', []))},
                    'doodle': {'ready': _models['doodle']['model'] is not None,
                               'subjects': len(_models['doodle']['classes']),
                               'epochs': len(log.get('epochs', []))},
                },
                'epochsTrained': len(log.get('epochs', [])),
                'lastLoss': log.get('epochs', [{}])[-1].get('loss') if log.get('epochs') else None,
            })
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if self.path == '/proof':
            return self.proof()
        if self.path == '/draw':
            return self.draw_request()
        return self._send(404, {'error': 'not found'})

    def proof(self):
        """Draws something, then digs up its closest matches in the training set."""
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        except Exception:
            return self._send(400, {'error': 'bad json'})
        if not load_if_newer():
            return self._send(503, {'error': 'model not ready'})

        want = str(body.get('subject', '')).strip().lower()
        classes = _models['doodle']['classes']
        idx = next((i for i, c in enumerate(classes) if c == want), None)
        if idx is None:
            return self._send(422, {'error': 'unknown subject', 'classes': classes})

        t0 = time.time()
        sample = draw('doodle', idx, 1, float(body.get('guidance', 1.0)), int(body.get('steps', 80)))
        stamp = int(time.time() * 1000)

        gen_name = f'proof_{stamp}_gen.png'
        to_png(sample[0], os.path.join(IMG, gen_name))

        # Model output is in [-1,1]; training data is [0,1].
        as01 = ((sample[0, 0].cpu().numpy() + 1) / 2).clip(0, 1)
        hits = nearest_neighbours(as01, classes[idx], k=3)

        near = []
        for j, (dist, img) in enumerate(hits):
            name = f'proof_{stamp}_near{j}.png'
            t = torch.from_numpy(img * 2 - 1).unsqueeze(0)
            to_png(t, os.path.join(IMG, name))
            near.append({'url': f'/api/gen/img/{name}', 'distance': round(dist, 2)})

        self._send(200, {'subject': classes[idx],
                         'generated': f'/api/gen/img/{gen_name}',
                         'nearest': near,
                         'searched': 30000,
                         'ms': int((time.time() - t0) * 1000)})

    def draw_request(self):
        """Draws one or more images, or the denoising as frames."""
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        except Exception:
            return self._send(400, {'error': 'bad json'})

        if not load_if_newer():
            return self._send(503, {'error': 'model still training, nothing to draw with yet'})

        want = str(body.get('subject', '')).strip().lower()
        kind, idx = find_subject(want)
        if idx is None:
            return self._send(422, {'error': 'unknown subject', 'classes': all_subjects()})
        st = _models[kind]
        classes = st['classes']

        n = max(1, min(4, int(body.get('n', 1))))
        guidance = float(body.get('guidance', 1.0))
        steps = max(20, min(200, int(body.get('steps', 80))))
        capture = max(0, min(24, int(body.get('capture', 0))))
        t0 = time.time()

        if capture:
            samples, frames = draw(kind, idx, 1, guidance, steps, capture)
            stamp = int(time.time() * 1000)
            urls = []
            for k, fr in enumerate(frames):
                name = f'step_{stamp}_{k:02d}.png'
                to_png(fr[0], os.path.join(IMG, name), colour=st['colour'])
                urls.append(f'/api/gen/img/{name}')
            return self._send(200, {'subject': classes[idx], 'kind': kind, 'frames': urls,
                                    'ms': int((time.time() - t0) * 1000)})

        samples = draw(kind, idx, n, guidance, steps)

        urls = []
        for i in range(n):
            name = f'{classes[idx].replace(" ", "_")}_{int(time.time() * 1000)}_{i}.png'
            to_png(samples[i], os.path.join(IMG, name), colour=st['colour'])
            urls.append(f'/api/gen/img/{name}')
        self._send(200, {'subject': classes[idx], 'kind': kind, 'images': urls,
                         'ms': int((time.time() - t0) * 1000)})


if __name__ == '__main__':
    # Deliberately not loading here: the model is pulled in on the first request,
    # so starting this while training runs costs nothing.
    print(f'[gen] drawing server on :{PORT} ({dev}, lazy load)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
