"""
A small class-conditional diffusion model, written from scratch.

No diffusers, no pretrained weights -- just the DDPM maths and a compact UNet.
It learns to turn pure noise into a 28x28 doodle of whichever class you ask for.
"""
import math
import torch
import torch.nn as nn
import torch.nn.functional as F


def cosine_schedule(T: int, s: float = 0.008) -> torch.Tensor:
    """Nichol & Dhariwal's cosine betas -- better than linear at low step counts."""
    t = torch.linspace(0, T, T + 1) / T
    f = torch.cos((t + s) / (1 + s) * math.pi / 2) ** 2
    alphas_cumprod = f / f[0]
    betas = 1 - alphas_cumprod[1:] / alphas_cumprod[:-1]
    return betas.clamp(1e-4, 0.999)


class TimeEmbedding(nn.Module):
    """Standard sinusoidal position encoding over the diffusion timestep."""

    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim
        self.mlp = nn.Sequential(nn.Linear(dim, dim * 4), nn.SiLU(), nn.Linear(dim * 4, dim * 4))

    def forward(self, t: torch.Tensor) -> torch.Tensor:
        half = self.dim // 2
        freqs = torch.exp(-math.log(10000) * torch.arange(half, device=t.device) / (half - 1))
        ang = t[:, None].float() * freqs[None]
        return self.mlp(torch.cat([ang.sin(), ang.cos()], dim=-1))


class Block(nn.Module):
    """Residual block, with the timestep+class signal injected as a per-channel bias."""

    def __init__(self, cin: int, cout: int, emb: int):
        super().__init__()
        self.norm1 = nn.GroupNorm(8, cin)
        self.conv1 = nn.Conv2d(cin, cout, 3, padding=1)
        self.emb = nn.Linear(emb, cout)
        self.norm2 = nn.GroupNorm(8, cout)
        self.conv2 = nn.Conv2d(cout, cout, 3, padding=1)
        self.skip = nn.Conv2d(cin, cout, 1) if cin != cout else nn.Identity()

    def forward(self, x, e):
        h = self.conv1(F.silu(self.norm1(x)))
        h = h + self.emb(F.silu(e))[:, :, None, None]
        h = self.conv2(F.silu(self.norm2(h)))
        return h + self.skip(x)


class UNet(nn.Module):
    """28 -> 14 -> 7 -> 14 -> 28, with skip connections."""

    def __init__(self, n_classes: int, base: int = 64, emb: int = 64):
        super().__init__()
        e = emb * 4
        self.time = TimeEmbedding(emb)
        # One extra embedding row is the "no class" token used by guidance.
        self.label = nn.Embedding(n_classes + 1, e)

        self.inp = nn.Conv2d(1, base, 3, padding=1)
        self.d1 = Block(base, base, e)
        self.d2 = Block(base, base * 2, e)
        self.d3 = Block(base * 2, base * 2, e)
        self.mid = Block(base * 2, base * 2, e)
        self.u3 = Block(base * 4, base * 2, e)
        self.u2 = Block(base * 4, base, e)
        self.u1 = Block(base * 2, base, e)
        self.out = nn.Sequential(nn.GroupNorm(8, base), nn.SiLU(), nn.Conv2d(base, 1, 3, padding=1))

    def forward(self, x, t, y):
        e = self.time(t) + self.label(y)

        h1 = self.d1(self.inp(x), e)              # 28
        h2 = self.d2(F.avg_pool2d(h1, 2), e)      # 14
        h3 = self.d3(F.avg_pool2d(h2, 2), e)      # 7

        m = self.mid(h3, e)

        u = self.u3(torch.cat([m, h3], 1), e)
        u = F.interpolate(u, scale_factor=2, mode='nearest')
        u = self.u2(torch.cat([u, h2], 1), e)
        u = F.interpolate(u, scale_factor=2, mode='nearest')
        u = self.u1(torch.cat([u, h1], 1), e)
        return self.out(u)


class Diffusion:
    """Forward noising and ancestral sampling, with classifier-free guidance."""

    def __init__(self, T: int, device: str):
        self.T = T
        self.device = device
        self.betas = cosine_schedule(T).to(device)
        self.alphas = 1.0 - self.betas
        self.acp = torch.cumprod(self.alphas, dim=0)
        self.sqrt_acp = self.acp.sqrt()
        self.sqrt_one_minus_acp = (1 - self.acp).sqrt()

    def add_noise(self, x0, t, noise):
        return self.sqrt_acp[t][:, None, None, None] * x0 + self.sqrt_one_minus_acp[t][:, None, None, None] * noise

    @torch.no_grad()
    def sample(self, model, labels, n_classes, guidance=3.0, steps=None):
        """Denoises pure noise into images of the requested classes."""
        model.eval()
        n = labels.shape[0]
        x = torch.randn(n, 1, 28, 28, device=self.device)
        null = torch.full_like(labels, n_classes)  # the "no class" token

        for i in reversed(range(self.T)):
            t = torch.full((n,), i, device=self.device, dtype=torch.long)
            eps_c = model(x, t, labels)
            if guidance > 0:
                eps_u = model(x, t, null)
                eps = eps_u + guidance * (eps_c - eps_u)
            else:
                eps = eps_c

            a, ac, b = self.alphas[i], self.acp[i], self.betas[i]
            mean = (x - b / (1 - ac).sqrt() * eps) / a.sqrt()
            if i > 0:
                prev = self.acp[i - 1]
                var = b * (1 - prev) / (1 - ac)   # posterior variance
                x = mean + var.sqrt() * torch.randn_like(x)
            else:
                x = mean

        model.train()
        return x.clamp(-1, 1)

    @torch.no_grad()
    def sample_ddim(self, model, labels, n_classes, guidance=3.0, steps=60):
        """
        Deterministic sampling over a strided subset of timesteps.

        Full ancestral sampling needs every one of the T steps, which is far too
        slow to sit behind a chat message. DDIM gets comparable quality from ~60.
        """
        model.eval()
        n = labels.shape[0]
        x = torch.randn(n, 1, 28, 28, device=self.device)
        null = torch.full_like(labels, n_classes)

        seq = torch.linspace(0, self.T - 1, steps).long().flip(0).tolist()

        for i, t_cur in enumerate(seq):
            t = torch.full((n,), t_cur, device=self.device, dtype=torch.long)
            eps = model(x, t, labels)
            if guidance > 0:
                eps_u = model(x, t, null)
                eps = eps_u + guidance * (eps - eps_u)

            ac = self.acp[t_cur]
            x0 = ((x - (1 - ac).sqrt() * eps) / ac.sqrt()).clamp(-1, 1)

            t_prev = seq[i + 1] if i + 1 < len(seq) else -1
            ac_prev = self.acp[t_prev] if t_prev >= 0 else torch.tensor(1.0, device=self.device)
            x = ac_prev.sqrt() * x0 + (1 - ac_prev).sqrt() * eps

        model.train()
        return x.clamp(-1, 1)
