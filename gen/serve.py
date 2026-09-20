"""
Keeps the trained generator warm in memory and draws on request.

The chat app talks to this over HTTP rather than spawning Python per image --
loading the checkpoint each time would add seconds to every drawing.
"""
import json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import UNet, Diffusion
from png import write_png

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
IMG = os.path.join(OUT, 'images')
os.makedirs(IMG, exist_ok=True)
PORT = int(os.environ.get('GEN_PORT', 4319))

# CPU by default and on purpose. Two processes both grabbing MPS contend badly
# on Apple Silicon -- it nearly froze the trainer -- and one 28x28 image is
# quick on CPU anyway. Set GEN_DEVICE=mps once training is finished if you want.
dev = os.environ.get('GEN_DEVICE', 'cpu')
_lock = threading.Lock()
_state = {'model': None, 'classes': [], 'diff': None, 'mtime': 0}


def load_if_newer():
    """Picks up a fresh checkpoint while training is still running."""
    path = os.path.join(OUT, 'model.pt')
    if not os.path.exists(path):
        return False
    mtime = os.path.getmtime(path)
    if _state['model'] is not None and mtime == _state['mtime']:
        return True
    ck = torch.load(path, map_location=dev)
    m = UNet(len(ck['classes'])).to(dev)
    m.load_state_dict(ck['model'])
    m.eval()
    _state.update(model=m, classes=ck['classes'], diff=Diffusion(ck['T'], dev), mtime=mtime)
    print(f'[gen] loaded checkpoint ({len(ck["classes"])} classes)', flush=True)
    return True


def to_png(sample, path, scale=6):
    """Upscales with nearest-neighbour so 28x28 is legible on screen."""
    arr = ((sample[0].cpu().numpy() + 1) * 127.5).clip(0, 255).astype('uint8')
    rows = []
    for r in arr:
        row = bytearray()
        for v in r:
            row.extend([255 - int(v)] * scale)   # invert: dark ink on white
        for _ in range(scale):
            rows.append(row)
    write_png(path, rows)


def draw(label_idx, n, guidance, steps, capture=0):
    with _lock:
        model, diff = _state['model'], _state['diff']
        labels = torch.full((n,), label_idx, device=dev, dtype=torch.long)
        return diff.sample_ddim(model, labels, len(_state['classes']),
                                guidance=guidance, steps=steps, capture=capture)


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
            return self._send(200, {
                'ready': ready,
                'classes': _state['classes'],
                'device': dev,
                'epochsTrained': len(log.get('epochs', [])),
                'lastLoss': log.get('epochs', [{}])[-1].get('loss') if log.get('epochs') else None,
            })
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/draw':
            return self._send(404, {'error': 'not found'})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        except Exception:
            return self._send(400, {'error': 'bad json'})

        if not load_if_newer():
            return self._send(503, {'error': 'model still training, nothing to draw with yet'})

        want = str(body.get('subject', '')).strip().lower()
        classes = _state['classes']
        # Exact match first, then a loose contains, so "a cat" or "kitty cat" lands.
        idx = next((i for i, c in enumerate(classes) if c == want), None)
        if idx is None:
            idx = next((i for i, c in enumerate(classes) if c in want or want in c), None)
        if idx is None:
            return self._send(422, {'error': 'unknown subject', 'classes': classes})

        n = max(1, min(4, int(body.get('n', 1))))
        guidance = float(body.get('guidance', 3.0))
        steps = max(20, min(200, int(body.get('steps', 60))))
        capture = max(0, min(24, int(body.get('capture', 0))))
        t0 = time.time()

        if capture:
            samples, frames = draw(idx, 1, guidance, steps, capture)
            stamp = int(time.time() * 1000)
            urls = []
            for k, fr in enumerate(frames):
                name = f'step_{stamp}_{k:02d}.png'
                to_png(fr[0], os.path.join(IMG, name))
                urls.append(f'/api/gen/img/{name}')
            return self._send(200, {'subject': classes[idx], 'frames': urls,
                                    'ms': int((time.time() - t0) * 1000)})

        samples = draw(idx, n, guidance, steps)

        urls = []
        for i in range(n):
            name = f'{classes[idx].replace(" ", "_")}_{int(time.time() * 1000)}_{i}.png'
            to_png(samples[i], os.path.join(IMG, name))
            urls.append(f'/api/gen/img/{name}')
        self._send(200, {'subject': classes[idx], 'images': urls, 'ms': int((time.time() - t0) * 1000)})


if __name__ == '__main__':
    # Deliberately not loading here: the model is pulled in on the first request,
    # so starting this while training runs costs nothing.
    print(f'[gen] drawing server on :{PORT} ({dev}, lazy load)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
