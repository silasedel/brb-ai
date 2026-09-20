"""Downloads the Quick Draw bitmaps the generator trains on (~2GB, resumable)."""
import os, sys, urllib.parse, urllib.request

CATS = ["cat", "dog", "pizza", "car", "house", "tree", "fish", "banana",
        "sun", "star", "bicycle", "apple", "snowman", "cactus", "ice cream", "octopus"]
BASE = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/"
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

os.makedirs(HERE, exist_ok=True)
for c in CATS:
    path = os.path.join(HERE, c.replace(" ", "_") + ".npy")
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        print(f"  {c}: already have it")
        continue
    print(f"  {c}: downloading…", flush=True)
    urllib.request.urlretrieve(BASE + urllib.parse.quote(c) + ".npy", path)
print("done. now run: npm run train")
