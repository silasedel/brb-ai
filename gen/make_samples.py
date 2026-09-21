"""
Renders a set of drawings from the finished model into web/public/samples/,
so the static GitHub Pages build can show what the generator produces even
though it has no Python behind it.
"""
import os, sys
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import UNet, Diffusion
from png import write_png

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEST = os.path.join(ROOT, 'web', 'public', 'samples')
os.makedirs(DEST, exist_ok=True)

# Which run to render from: the colour model if it has been trained, else doodles.
KIND = os.environ.get('KIND', 'colour')
SRC = os.path.join(HERE, 'out_color' if KIND == 'colour' else 'out')
WANT = (['elephant', 'castle', 'sunflower', 'mountain', 'tiger', 'rose', 'dolphin', 'forest']
        if KIND == 'colour'
        else ['cat', 'house', 'bicycle', 'ice cream', 'snowman', 'star', 'octopus', 'pizza'])
dev = os.environ.get('GEN_DEVICE', 'cpu')

ck = torch.load(os.path.join(SRC, 'model.pt'), map_location=dev)
classes = ck['classes']
model = UNet(len(classes), base=ck.get('base', 64),
             in_ch=ck.get('in_ch', 1), attn=ck.get('attn', False)).to(dev)
model.load_state_dict(ck['model'])
model.eval()
diff = Diffusion(ck['T'], dev)
COLOUR = ck.get('in_ch', 1) == 3
SHAPE = (3, 32, 32) if COLOUR else (1, 28, 28)


def save(sample, path, scale=6):
    a = ((sample.cpu().numpy() + 1) * 127.5).clip(0, 255).astype('uint8')
    rows = []
    if COLOUR:
        for r in a.transpose(1, 2, 0):
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
                row.extend([255 - int(v)] * scale)
            for _ in range(scale):
                rows.append(row)
        write_png(path, rows)


torch.manual_seed(7)   # reproducible picks, so the site doesn't churn
for name in WANT:
    if name not in classes:
        print(f'  skip {name} (not trained)')
        continue
    idx = classes.index(name)
    labels = torch.full((1,), idx, device=dev, dtype=torch.long)
    out = diff.sample_ddim(model, labels, len(classes),
                           guidance=2.0 if COLOUR else 1.0, steps=80, shape=SHAPE)
    fn = name.replace(' ', '_') + '.png'
    save(out[0], os.path.join(DEST, fn))
    print(f'  {name} -> web/public/samples/{fn}')
print('done')
