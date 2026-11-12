#!/usr/bin/env python3
"""ABYSS CODE の巻物の質感（羊皮紙と木の軸）を計算で作る。

使い方: python3 tools/make_scroll_textures.py
出力: launcher-scroll.jpg（羊皮紙）, launcher-rod.jpg（木の軸）
必要なもの: numpy, scipy, Pillow
乱数の種を固定してあるので、何度作っても同じ絵になる。
"""
import numpy as np
from scipy import ndimage as ndi
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
rng = np.random.default_rng(20261112)


def smooth(t, a, b):
    t = np.clip((t - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(h, w, base, octaves=5, pers=.55, aspect=1.0):
    """なめらかな雑音の重ね合わせ（0〜1）。aspect>1 で横に伸びた模様になる"""
    acc = np.zeros((h, w)); amp = 1.0; tot = 0
    for o in range(octaves):
        gy = max(2, int(base * (2 ** o)))
        gx = max(2, int(base * (2 ** o) * aspect))
        g = rng.random((gy, gx))
        acc += amp * ndi.zoom(g, (h / gy, w / gx), order=3)[:h, :w]
        tot += amp; amp *= pers
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min())


def lerp(a, b, t):
    return a + (b - a) * t[..., None]


def parchment(W=800, H=1300):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # ---- 色むら: 大きなしみ・日焼け
    cloud = fbm(H, W, 3, 6, .6)
    blot = fbm(H, W, 7, 4, .5)
    t = np.clip(cloud * .75 + blot * .35, 0, 1)
    light = np.array([228, 211, 172], np.float32)
    mid = np.array([196, 168, 122], np.float32)
    dark = np.array([146, 112, 70], np.float32)
    col = lerp(lerp(light, mid, smooth(t, .25, .65)), dark, smooth(t, .62, 1.0) * .8)
    # ---- 水じみ（輪の縁だけ濃い）と、点々としたしみ
    for _ in range(3):
        cx, cy = rng.uniform(.15, .85) * W, rng.uniform(.12, .88) * H
        r = rng.uniform(.14, .26) * W
        d = np.hypot(xx - cx, yy - cy) + (fbm(H, W, 5, 3) - .5) * r * .5
        ring = np.exp(-((d - r) / (r * .16)) ** 2) * .13
        fill = smooth(r - d, 0, r * .9) * .07
        m = ndi.gaussian_filter(ring + fill, 2.5)
        col *= (1 - m)[..., None] * np.array([1, .98, .94], np.float32)
    fox = (fbm(H, W, 60, 2, .6) > .90).astype(np.float32)
    fox = ndi.gaussian_filter(fox, 1.6)
    col *= (1 - .22 * np.clip(fox * 3, 0, 1))[..., None] * np.array([1, .94, .86], np.float32)
    # ---- 高さの地図: 繊維・ゆるい凹凸・折り目
    sel = ndi.zoom(rng.random((8, 6)), (H / 8, W / 6), order=3)[:H, :W]       # 繊維の向きをまだらに
    fiber = ndi.gaussian_filter(rng.standard_normal((H, W)), (.7, 5.0)) * sel \
        + ndi.gaussian_filter(rng.standard_normal((H, W)), (5.0, .7)) * (1 - sel) * .7
    fiber /= fiber.std()
    grain = ndi.gaussian_filter(rng.standard_normal((H, W)), 1.1); grain /= grain.std()
    wrinkle = fbm(H, W, 6, 5, .5)
    hm = wrinkle * 16 + fiber * .22 + grain * .2
    for y0 in (rng.uniform(.18, .32) * H, rng.uniform(.5, .62) * H, rng.uniform(.72, .86) * H):
        wav = (fbm(H, W, 2, 2) - .5) * 70
        dd = yy - y0 + wav
        hm += -np.exp(-(dd / 9) ** 2) * 2.6 + np.exp(-((dd - 10) / 14) ** 2) * 1.4
    # ---- 光の当て方（左上から）
    gy, gx = np.gradient(ndi.gaussian_filter(hm, .6))
    nx, ny, nz = -gx * .9, -gy * .9, np.ones_like(gx)
    nl = np.sqrt(nx * nx + ny * ny + nz * nz)
    L = np.array([-.45, -.6, .66]); L /= np.linalg.norm(L)
    shade = (nx * L[0] + ny * L[1] + nz * L[2]) / nl
    shade = np.clip(shade, 0, 1.2)
    col *= (.52 + .62 * shade)[..., None]
    # 紙のうっすらした透け（繊維）
    col *= (1 + .035 * fiber)[..., None]
    # ---- 縁の焦げと日焼け（縁はぎざぎざの境で濃くなる）
    edge = np.minimum.reduce([xx, yy, W - 1 - xx, H - 1 - yy]) / W
    noisy = edge + (fbm(H, W, 12, 5, .55) - .5) * .09
    burn = 1 - smooth(noisy, .005, .075)
    char = 1 - smooth(noisy, -.02, .025)
    col = lerp(col, np.array([84, 52, 22], np.float32), burn * .5)
    col = lerp(col, np.array([28, 14, 6], np.float32), char * .7)
    # ---- 全体の周辺減光
    v = 1 - .22 * smooth(np.hypot((xx / W - .5) * 1.1, (yy / H - .5) * .9), .25, .8)
    col *= v[..., None]
    img = np.clip(col, 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(OUT, 'launcher-scroll.jpg'), quality=80, optimize=True, progressive=True)


def rod(W=1400, H=64):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = (yy + .5) / H * 2 - 1                      # -1(上)〜1(下)
    warp = (fbm(H, W, 3, 3, .5, aspect=6) - .5) * 5.0
    rings = np.sin((yy * .55 + warp * 2.2 + fbm(H, W, 2, 2, .5, aspect=14) * 6) * 2 * np.pi / 7)
    fine = ndi.gaussian_filter(rng.standard_normal((H, W)), (.4, 14)); fine /= fine.std()
    grain = .5 + .22 * rings + .12 * fine
    c1 = np.array([52, 26, 10], np.float32); c2 = np.array([128, 78, 38], np.float32)
    col = lerp(c1, c2, np.clip(grain, 0, 1))
    th = np.arccos(np.clip(u * .96, -1, 1))        # 円柱の角度
    diff = np.clip(np.sin(th - .15) * .95 + .08, 0, 1.1)
    col *= (.18 + 1.05 * diff)[..., None]
    spec = np.exp(-((u + .40) / .10) ** 2) * .50 + np.exp(-((u + .40) / .30) ** 2) * .10
    col += spec[..., None] * np.array([255, 224, 170], np.float32) * .55
    col *= (1 - .55 * smooth(u, .55, 1.0))[..., None]   # 下側の影
    img = np.clip(col, 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(OUT, 'launcher-rod.jpg'), quality=85, optimize=True)


if __name__ == '__main__':
    parchment(); rod()
    for n in ('launcher-scroll.jpg', 'launcher-rod.jpg'):
        print(n, os.path.getsize(os.path.join(OUT, n)) // 1024, 'KB')
