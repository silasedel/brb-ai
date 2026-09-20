"""
Trains the doodle generator from scratch.

Writes a sample grid after every epoch so you can watch it go from static to
recognisable drawings, plus a JSON log the viewer page reads.
"""
import json, os, sys, time
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from model import UNet, Diffusion
from png import write_png

HERE = os.path.dirname(os.path.abspath(__file__))
DATA, OUT = os.path.join(HERE, 'data'), os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

PER_CLASS = int(os.environ.get('PER_CLASS', 30000))
EPOCHS = int(os.environ.get('EPOCHS', 14))
BATCH = int(os.environ.get('BATCH', 256))
T = 400

dev = 'mps' if torch.backends.mps.is_available() else 'cpu'


def load():
    names, xs, ys = [], [], []
    for f in sorted(os.listdir(DATA)):
        if not f.endswith('.npy'):
            continue
        name = f[:-4].replace('_', ' ')
        arr = np.load(os.path.join(DATA, f), mmap_mode='r')
        take = min(PER_CLASS, arr.shape[0])
        xs.append(np.array(arr[:take]))
        ys.append(np.full(take, len(names), dtype=np.int64))
        names.append(name)
        print(f'  {name:<10} {take:,}')
    x = np.concatenate(xs).reshape(-1, 1, 28, 28).astype(np.float32)
    x = x / 127.5 - 1.0                      # to [-1, 1], the range the model predicts in
    return torch.from_numpy(x), torch.from_numpy(np.concatenate(ys)), names


def grid(samples, cols):
    """Tiles samples into one image buffer for a PNG."""
    n = samples.shape[0]
    rows_n = (n + cols - 1) // cols
    img = np.zeros((rows_n * 28, cols * 28), dtype=np.uint8)
    arr = ((samples[:, 0].cpu().numpy() + 1) * 127.5).clip(0, 255).astype(np.uint8)
    for i in range(n):
        r, c = divmod(i, cols)
        img[r * 28:(r + 1) * 28, c * 28:(c + 1) * 28] = arr[i]
    return [bytearray(row) for row in 255 - img]   # invert: dark ink on white


print(f'device: {dev}')
print('loading…')
X, Y, NAMES = load()
N, C = X.shape[0], len(NAMES)
print(f'{N:,} images, {C} classes')

model = UNet(C).to(dev)
diff = Diffusion(T, dev)
opt = torch.optim.Adam(model.parameters(), lr=2e-4)
print(f'params: {sum(p.numel() for p in model.parameters()):,}')

# A fixed preview set, so the same classes are compared across every epoch.
preview = torch.arange(C, device=dev).repeat_interleave(2)
log = {'classes': NAMES, 'epochs': [], 'perClass': PER_CLASS, 'total': N}
steps_per_epoch = N // BATCH
t_start = time.time()

for ep in range(1, EPOCHS + 1):
    perm = torch.randperm(N)
    run, t0 = 0.0, time.time()

    for s in range(steps_per_epoch):
        idx = perm[s * BATCH:(s + 1) * BATCH]
        x0 = X[idx].to(dev, non_blocking=True)
        y = Y[idx].to(dev, non_blocking=True)

        # Classifier-free guidance: hide the label 10% of the time so the model
        # also learns an unconditional score to steer away from.
        drop = torch.rand(y.shape[0], device=dev) < 0.1
        y = torch.where(drop, torch.full_like(y, C), y)

        t = torch.randint(0, T, (x0.shape[0],), device=dev)
        noise = torch.randn_like(x0)
        pred = model(diff.add_noise(x0, t, noise), t, y)
        loss = torch.nn.functional.mse_loss(pred, noise)

        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        run += loss.item()

        if s % 200 == 0:
            print(f'  ep{ep} {s}/{steps_per_epoch} loss {run / (s + 1):.4f}', flush=True)

    avg = run / steps_per_epoch
    samples = diff.sample(model, preview, C, guidance=3.0)
    write_png(os.path.join(OUT, f'epoch_{ep:02d}.png'), grid(samples, 8))
    torch.save({'model': model.state_dict(), 'classes': NAMES, 'T': T}, os.path.join(OUT, 'model.pt'))

    log['epochs'].append({'epoch': ep, 'loss': round(avg, 5), 'seconds': round(time.time() - t0, 1)})
    with open(os.path.join(OUT, 'log.json'), 'w') as f:
        json.dump(log, f, indent=1)
    print(f'epoch {ep}/{EPOCHS}  loss {avg:.4f}  {time.time() - t0:.0f}s  (total {(time.time() - t_start) / 60:.1f}m)', flush=True)

print('done')
