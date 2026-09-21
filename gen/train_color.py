"""
Trains the colour generator on CIFAR-100: 100 real objects, 32x32 RGB.

The doodle model learned line drawings. This one learns photographs, which is
what makes the output read as an image rather than something you could have
hand-drawn in advance.
"""
import json, math, os, pickle, sys, time
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import UNet, Diffusion
from png import write_png

HERE = os.path.dirname(os.path.abspath(__file__))
CIFAR = os.path.join(HERE, 'cifar', 'cifar-100-python')
OUT = os.path.join(HERE, 'out_color')
os.makedirs(OUT, exist_ok=True)

EPOCHS = int(os.environ.get('EPOCHS', 120))
BATCH = int(os.environ.get('BATCH', 256))
BASE = int(os.environ.get('BASE', 128))
T = 400
dev = 'mps' if torch.backends.mps.is_available() else 'cpu'

# Shown in the sample grid each epoch: recognisable, visually distinct classes.
PREVIEW = ['apple', 'bear', 'bicycle', 'butterfly', 'castle', 'dolphin', 'elephant', 'forest',
           'house', 'mountain', 'orange', 'rose', 'sunflower', 'tiger', 'train', 'tulip']


def load():
    with open(os.path.join(CIFAR, 'train'), 'rb') as f:
        d = pickle.load(f, encoding='bytes')
    with open(os.path.join(CIFAR, 'meta'), 'rb') as f:
        m = pickle.load(f, encoding='bytes')
    names = [n.decode() for n in m[b'fine_label_names']]
    x = d[b'data'].reshape(-1, 3, 32, 32).astype(np.float32) / 127.5 - 1.0
    y = np.array(d[b'fine_labels'], dtype=np.int64)
    return torch.from_numpy(x), torch.from_numpy(y), names


def grid(samples, cols=8):
    """Tiles RGB samples into one PNG buffer (3 bytes per pixel)."""
    n = samples.shape[0]
    rows_n = (n + cols - 1) // cols
    arr = ((samples.cpu().numpy().transpose(0, 2, 3, 1) + 1) * 127.5).clip(0, 255).astype(np.uint8)
    img = np.zeros((rows_n * 32, cols * 32, 3), dtype=np.uint8)
    for i in range(n):
        r, c = divmod(i, cols)
        img[r * 32:(r + 1) * 32, c * 32:(c + 1) * 32] = arr[i]
    return [bytearray(row.tobytes()) for row in img]


print(f'device: {dev}')
X, Y, NAMES = load()
N, C = X.shape[0], len(NAMES)
# 614MB of unified memory: keeping the whole set on the GPU removes a per-step
# CPU gather and host->device copy from the hot loop.
X, Y = X.to(dev), Y.to(dev)
print(f'{N:,} colour images, {C} classes (resident on {dev})')

model = UNet(C, base=BASE, in_ch=3, attn=True).to(dev)
diff = Diffusion(T, dev)
opt = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
print(f'params: {sum(p.numel() for p in model.parameters()):,}')

# Exponential moving average of the weights. Diffusion samples are markedly
# cleaner from an averaged copy than from the live ones, which jitter from step
# to step -- it is the cheapest quality win available here, so sampling and the
# saved checkpoint both use the EMA.
ema = UNet(C, base=BASE, in_ch=3, attn=True).to(dev)
ema.load_state_dict(model.state_dict())
for q in ema.parameters():
    q.requires_grad_(False)
# Longer run -> longer averaging horizon; 0.9999 spans ~10k steps.
EMA_DECAY = float(os.environ.get('EMA', 0.9999))


_ema_p = list(ema.parameters())
_mdl_p = list(model.parameters())


@torch.no_grad()
def update_ema():
    # One fused op rather than ~95 separate kernel launches per step.
    torch._foreach_lerp_(_ema_p, _mdl_p, 1 - EMA_DECAY)


WARMUP = 1000
step_count = 0

preview_idx = torch.tensor([NAMES.index(p) for p in PREVIEW], device=dev)
log = {'classes': NAMES, 'preview': PREVIEW, 'epochs': [], 'total': N, 'colour': True}
steps_per_epoch = N // BATCH
total_steps = EPOCHS * steps_per_epoch
t_start = time.time()

for ep in range(1, EPOCHS + 1):
    perm = torch.randperm(N, device=dev)
    run, t0 = 0.0, time.time()

    for s in range(steps_per_epoch):
        idx = perm[s * BATCH:(s + 1) * BATCH]
        x0 = X[idx]
        y = Y[idx]

        # Horizontal flips: 500 images per class is thin, and a mirrored photo
        # is still a valid photo, so this effectively doubles the data for free.
        flip = torch.rand(x0.shape[0], device=dev) < 0.5
        x0 = torch.where(flip[:, None, None, None], x0.flip(-1), x0)

        drop = torch.rand(y.shape[0], device=dev) < 0.1
        y = torch.where(drop, torch.full_like(y, C), y)

        t = torch.randint(0, T, (x0.shape[0],), device=dev)
        noise = torch.randn_like(x0)
        loss = torch.nn.functional.mse_loss(model(diff.add_noise(x0, t, noise), t, y), noise)

        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)

        # Short warmup: diffusion training is unstable in the first few hundred
        # steps at full learning rate.
        step_count += 1
        if step_count <= WARMUP:
            lr = 2e-4 * step_count / WARMUP
        else:
            # Cosine decay to a tenth: large steps early to move fast, small
            # steps late so the weights settle instead of jittering.
            prog = (step_count - WARMUP) / max(total_steps - WARMUP, 1)
            lr = 2e-4 * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(prog, 1.0))))
        for g in opt.param_groups:
            g['lr'] = lr

        opt.step()
        update_ema()
        run += loss.item()

        if s % 100 == 0:
            print(f'  ep{ep} {s}/{steps_per_epoch} loss {run / (s + 1):.4f}', flush=True)

    avg = run / steps_per_epoch
    # Sampling every epoch would cost more than training does; every few is plenty.
    if ep <= 5 or ep % 10 == 0 or ep == EPOCHS:
        samples = diff.sample_ddim(ema, preview_idx, C, guidance=2.0, steps=60, shape=(3, 32, 32))
        write_png(os.path.join(OUT, f'epoch_{ep:03d}.png'), grid(samples), colour=True)
        torch.save({'model': ema.state_dict(), 'classes': NAMES, 'T': T,
                    'base': BASE, 'in_ch': 3, 'attn': True}, os.path.join(OUT, 'model.pt'))
        log['epochs'].append({'epoch': ep, 'loss': round(avg, 5), 'seconds': round(time.time() - t0, 1)})
        with open(os.path.join(OUT, 'log.json'), 'w') as f:
            json.dump(log, f, indent=1)

    print(f'epoch {ep}/{EPOCHS}  loss {avg:.4f}  {time.time() - t0:.0f}s  (total {(time.time() - t_start) / 60:.1f}m)', flush=True)

print('done')
