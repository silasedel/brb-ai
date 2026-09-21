"""
Answers "is it just copying?" with evidence.

Given a generated image, finds the most similar images in the actual training
set. If the model were memorising, its output would match a training example
almost exactly. If it's generating, the nearest neighbours are merely similar --
same kind of thing, different drawing.
"""
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

_cache = {}


def _load(class_name: str) -> np.ndarray:
    """Training images for one class, flattened and L2-normalised."""
    if class_name in _cache:
        return _cache[class_name]
    path = os.path.join(DATA, class_name.replace(' ', '_') + '.npy')
    if not os.path.exists(path):
        return None
    # Same slice the trainer used, so we're comparing against what it actually saw.
    arr = np.array(np.load(path, mmap_mode='r')[:30000]).astype(np.float32) / 255.0
    _cache[class_name] = arr
    return arr


def nearest(sample: np.ndarray, class_name: str, k: int = 3):
    """
    sample: 28x28 float array in [0,1].
    Returns [(distance, image)] for the k closest training images.
    """
    bank = _load(class_name)
    if bank is None:
        return []
    q = sample.reshape(1, -1)
    # Euclidean distance expanded so it's one matrix product rather than a loop.
    d = (bank ** 2).sum(1) - 2 * (bank @ q.T).ravel() + (q ** 2).sum()
    idx = np.argpartition(d, k)[:k]
    idx = idx[np.argsort(d[idx])]
    return [(float(np.sqrt(max(d[i], 0))), bank[i].reshape(28, 28)) for i in idx]
