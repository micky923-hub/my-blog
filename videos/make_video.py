#!/usr/bin/env python3
"""글 요약 쇼츠 영상 재료 만들기.

videos/{slug}/video.json 하나를 원본으로 아래 파일을 만든다.
  - videos/{slug}/captions.srt         (커밋함)
  - videos/{slug}/scenes/01~05.png      (커밋 안 함)
  - videos/{slug}/draft.mp4             (커밋 안 함, 1080x1920 30fps H.264 + 무음 AAC)
  - images/posts/{slug}-video-poster.jpg (540x960, 100KB 이하)

사용법:
  python3 videos/make_video.py all
  python3 videos/make_video.py 2026-year-end-tax-settlement-guide --only srt
  python3 videos/make_video.py all --font-dir /path/to/fonts

글꼴: Pretendard(OFL 1.1). --font-dir 또는 환경 변수 VIDEO_FONT_DIR, 기본값 videos/fonts/.
필요한 것: Python Pillow·numpy, ffmpeg, node + playwright(전역 설치 가능), Chromium.
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEOS = os.path.join(ROOT, "videos")

W, H = 1080, 1920
FPS = 30
ZOOM = 0.05          # 1.00 -> 1.05
FADE = 0.3           # 장면 사이 페이드(초)

# 안전 영역: 글자는 가로 80~880, 세로 260~1460 안에만.
SAFE = (80, 260, 880, 1460)
# 확대(1.05) 후에도 안전 영역 안에 남도록 내용은 이 범위 안에 그린다.
CX, CY = W / 2, H / 2
INNER_L = int(CX - (CX - SAFE[0]) / (1 + ZOOM)) + 2      # 102
INNER_R = int(CX + (SAFE[2] - CX) / (1 + ZOOM)) - 2      # 856
INNER_T = int(CY - (CY - SAFE[1]) / (1 + ZOOM)) + 6      # 300
MIDX = (INNER_L + INNER_R) / 2   # 안전 영역 가운데(오른쪽 버튼 자리를 뺀 가운데)
CONTENT_B = 1270     # 확대 후 약 1286, 자막 줄(1300~) 위
CAP_TOP, CAP_BOT = 1300, 1440

# 블로그 라이트 팔레트
C = {
    "bg": "#f9fafb", "card": "#ffffff", "text": "#1a1a1a", "sub": "#555555",
    "accent": "#2563eb", "accent_bg": "#eff6ff", "border": "#e5e7eb",
}

FONT_FILES = {
    "regular": "Pretendard-Regular.otf",
    "semibold": "Pretendard-SemiBold.otf",
    "bold": "Pretendard-Bold.otf",
    "extrabold": "Pretendard-ExtraBold.otf",
}

FONT_DIR = None
_font_cache = {}


def die(msg):
    print("오류: " + msg, file=sys.stderr)
    sys.exit(1)


def setup_fonts(font_dir):
    global FONT_DIR
    font_dir = font_dir or os.environ.get("VIDEO_FONT_DIR") or os.path.join(VIDEOS, "fonts")
    missing = [f for f in FONT_FILES.values() if not os.path.isfile(os.path.join(font_dir, f))]
    if missing:
        die(
            "글꼴을 찾지 못했습니다: %s (찾은 곳: %s)\n"
            "Pretendard(OFL 1.1)를 받아 넣어 주세요:\n"
            "  cd /tmp && npm pack pretendard && tar xzf pretendard-*.tgz\n"
            "  mkdir -p %s && cp package/dist/public/static/alternative/Pretendard-{Regular,SemiBold,Bold,ExtraBold}.otf %s/\n"
            "  (또는 package/dist/public/static/ 아래의 .otf)\n"
            "다른 곳에 있다면 --font-dir 또는 VIDEO_FONT_DIR 로 알려 주세요."
            % (", ".join(missing), font_dir, os.path.join(VIDEOS, "fonts"), os.path.join(VIDEOS, "fonts"))
        )
    FONT_DIR = font_dir


def font(weight, size):
    key = (weight, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(os.path.join(FONT_DIR, FONT_FILES[weight]), size)
    return _font_cache[key]


# ---------------------------------------------------------------- 글자 도구

def parse_marked(line):
    """'동료는 [[50만 원]] 환급' -> [(text, accent?)]"""
    parts = []
    for i, seg in enumerate(re.split(r"\[\[|\]\]", line)):
        if seg:
            parts.append((seg, i % 2 == 1))
    return parts


def plain(line):
    return line.replace("[[", "").replace("]]", "")


def text_w(s, f):
    return f.getlength(s)


def draw_marked(draw, x, y, line, f, color, accent, align="left", max_w=None, where=""):
    parts = parse_marked(line)
    total = sum(text_w(t, f) for t, _ in parts)
    if max_w is not None and total > max_w + 0.5:
        die("%s 줄이 너무 깁니다(%dpx > %dpx): %s" % (where, total, max_w, plain(line)))
    if align == "center":
        x = x - total / 2
    for t, acc in parts:
        draw.text((x, y), t, font=f, fill=accent if acc else color)
        x += text_w(t, f)
    return total


def wrap(text, f, max_w):
    """띄어쓰기 기준으로 줄바꿈. 한 단어가 너무 길면 글자 단위로 자른다."""
    words = text.split(" ")
    lines, cur = [], ""
    for w_ in words:
        cand = (cur + " " + w_).strip()
        if text_w(cand, f) <= max_w:
            cur = cand
            continue
        if cur:
            lines.append(cur)
        cur = ""
        for ch in w_:
            if text_w(cur + ch, f) <= max_w:
                cur += ch
            else:
                lines.append(cur)
                cur = ch
    if cur:
        lines.append(cur)
    return lines


def rrect(draw, box, r, fill, outline=None, width=0):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def line_h(f):
    a, d = f.getmetrics()
    return a + d


# ---------------------------------------------------------------- SVG -> PNG

NODE_RENDER = r"""
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('playwright 모듈을 찾지 못했습니다'); process.exit(2); }
const [,, jobsFile] = process.argv;
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
(async () => {
  const opts = {};
  if (jobs.executablePath) opts.executablePath = jobs.executablePath;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const j of jobs.items) {
    const svg = fs.readFileSync(j.svg, 'utf8');
    const faces = jobs.fonts.map(f =>
      `@font-face{font-family:'Pretendard';src:url('file://${f.file}');font-weight:${f.weight};}`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
      html,body{margin:0;padding:0;background:transparent}
      #w{width:${j.width}px;display:inline-block;line-height:0}
      #w svg{width:${j.width}px;height:auto;display:block}</style></head>
      <body><div id="w">${svg}</div></body></html>`;
    const tmp = path.join(path.dirname(j.out), '_render.html');
    fs.writeFileSync(tmp, html);
    await page.setViewportSize({ width: j.width + 20, height: 2400 });
    await page.goto('file://' + tmp);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const el = await page.$('#w');
    await el.screenshot({ path: j.out, omitBackground: true });
    fs.unlinkSync(tmp);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
"""


def find_chromium():
    env = os.environ.get("CHROMIUM_PATH")
    if env and os.path.isfile(env):
        return env
    pats = [
        "/opt/pw-browsers/chromium-*/chrome-linux/chrome",
        "/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell",
        os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome"),
    ]
    for p in pats:
        hits = sorted(glob.glob(p))
        if hits:
            return hits[-1]
    return None  # playwright 기본값에 맡김


def render_svgs(items):
    """items: [(svg_path, out_png, width)]"""
    todo = [it for it in items
            if not os.path.isfile(it[1]) or os.path.getmtime(it[1]) < os.path.getmtime(it[0])]
    if not todo:
        return
    node = shutil.which("node")
    if not node:
        die("node 를 찾지 못했습니다(SVG 렌더에 Playwright 필요).")
    npm_root = ""
    try:
        npm_root = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
    except OSError:
        pass
    weights = {"regular": 400, "semibold": 600, "bold": 700, "extrabold": 800}
    jobs = {
        "executablePath": find_chromium(),
        "fonts": [{"file": os.path.join(FONT_DIR, FONT_FILES[k]), "weight": v} for k, v in weights.items()],
        "items": [{"svg": s, "out": o, "width": w} for s, o, w in todo],
    }
    with tempfile.TemporaryDirectory() as td:
        jf = os.path.join(td, "jobs.json")
        js = os.path.join(td, "render.js")
        with open(jf, "w") as fh:
            json.dump(jobs, fh)
        with open(js, "w") as fh:
            fh.write(NODE_RENDER)
        env = dict(os.environ)
        paths = [os.path.join(ROOT, "node_modules")] + ([npm_root] if npm_root else [])
        env["NODE_PATH"] = os.pathsep.join(paths + [env.get("NODE_PATH", "")])
        r = subprocess.run([node, js, jf], env=env)
        if r.returncode != 0:
            die("SVG 렌더에 실패했습니다(Playwright·Chromium 확인).")


# ---------------------------------------------------------------- 장면 그리기

def new_canvas():
    img = Image.new("RGB", (W, H), C["bg"])
    d = ImageDraw.Draw(img)
    # 장식(글자 없음): 위쪽 강조 띠와 부드러운 원
    d.rectangle((0, 0, W, 14), fill=C["accent"])
    d.ellipse((760, -220, 1340, 360), fill=C["accent_bg"])
    d.ellipse((-260, 1500, 300, 2060), fill=C["accent_bg"])
    return img, d


def draw_chip(d, text, y, x=INNER_L):
    f = font("bold", 52)
    tw = text_w(text, f)
    h = 80
    rrect(d, (x, y, x + tw + 56, y + h), 40, C["accent_bg"])
    a, _ = f.getmetrics()
    d.text((x + 28, y + (h - line_h(f)) / 2 - 2), text, font=f, fill=C["accent"])
    return y + h


def draw_lines(d, lines, y, size, weight="extrabold", gap=1.22, align="left", where=""):
    f = font(weight, size)
    lh = int(size * gap)
    x = INNER_L if align == "left" else MIDX
    for ln in lines:
        draw_marked(d, x, y, ln, f, C["text"], C["accent"], align=align,
                    max_w=INNER_R - INNER_L, where=where)
        y += lh
    return y


def draw_big_card(d, y, big, label, where, big_size=96):
    """흰 카드 안에 핵심 숫자(크게) + 설명 한 줄."""
    fb = font("extrabold", big_size)
    fl = font("semibold", 52)
    inner = INNER_R - INNER_L - 80
    if text_w(big, fb) > inner:
        die("%s 핵심 숫자가 너무 깁니다: %s" % (where, big))
    lab = wrap(label, fl, inner)
    if len(lab) > 2:
        die("%s 숫자 설명이 2줄을 넘습니다: %s" % (where, label))
    h = 40 + line_h(fb) + 12 + len(lab) * int(52 * 1.3) + 36
    rrect(d, (INNER_L, y, INNER_R, y + h), 36, C["card"], outline=C["border"], width=3)
    d.rectangle((INNER_L, y + 30, INNER_L + 10, y + h - 30), fill=C["accent"])
    yy = y + 36
    d.text((INNER_L + 44, yy), big, font=fb, fill=C["accent"])
    yy += line_h(fb) + 12
    for ln in lab:
        d.text((INNER_L + 44, yy), ln, font=fl, fill=C["sub"])
        yy += int(52 * 1.3)
    return y + h


def scene_hook(sc, where, y0=None):
    img, d = new_canvas()
    y = draw_chip(d, sc["chip"], y0)
    y += 70
    y = draw_lines(d, sc["lines"], y, 88, where=where)
    if sc.get("sub"):
        y += 40
        f = font("semibold", 56)
        for ln in sc["sub"]:
            if text_w(ln, f) > INNER_R - INNER_L:
                die("%s 부제 줄이 깁니다: %s" % (where, ln))
            d.text((INNER_L, y), ln, font=f, fill=C["sub"])
            y += int(56 * 1.3)
    if sc.get("big"):
        y += 60
        y = draw_big_card(d, y, sc["big"], sc.get("label", ""), where)
    return img, y


def scene_point(sc, where, y0=None):
    img, d = new_canvas()
    y = draw_chip(d, sc["chip"], y0)
    y += 60
    y = draw_lines(d, sc["lines"], y, 80, where=where)
    y += 70
    y = draw_big_card(d, y, sc["big"], sc["label"], where, big_size=120)
    return img, y


def scene_figure(sc, where, fig_png):
    img, d = new_canvas()
    y = draw_chip(d, sc["chip"], INNER_T)
    y += 28
    y = draw_lines(d, sc["lines"], y, 72, gap=1.18, where=where)
    y += 16
    # 핵심 숫자 띠(강조 바탕)
    fb = font("extrabold", 88)
    fl = font("semibold", 52)
    if text_w(sc["big"], fb) > INNER_R - INNER_L - 60:
        die("%s 핵심 숫자가 너무 깁니다" % where)
    if text_w(sc["label"], fl) > INNER_R - INNER_L - 60:
        die("%s 숫자 설명이 깁니다: %s" % (where, sc["label"]))
    bh = line_h(fb) + line_h(fl) + 40
    rrect(d, (INNER_L, y, INNER_R, y + bh), 32, C["accent_bg"])
    d.text((INNER_L + 30, y + 14), sc["big"], font=fb, fill=C["accent"])
    d.text((INNER_L + 30, y + 14 + line_h(fb) + 2), sc["label"], font=fl, fill=C["text"])
    y += bh + 20
    # 그림 카드
    card = (INNER_L, y, INNER_R, CONTENT_B)
    rrect(d, card, 32, C["card"], outline=C["border"], width=3)
    fig = Image.open(fig_png).convert("RGBA")
    pad = 20
    mw, mh = card[2] - card[0] - pad * 2, card[3] - card[1] - pad * 2
    if mh < 380:
        die("%s 그림 자리가 너무 작습니다(%dpx). 제목 줄을 줄이세요." % (where, mh))
    s = min(mw / fig.width, mh / fig.height)
    fig = fig.resize((int(fig.width * s), int(fig.height * s)), Image.LANCZOS)
    fx = card[0] + (card[2] - card[0] - fig.width) // 2
    fy = card[1] + (card[3] - card[1] - fig.height) // 2
    img.paste(fig, (fx, fy), fig)
    return img, CONTENT_B


def centered(fn, sc, where):
    """내용 높이를 먼저 재고, 위아래 빈 곳이 고르게(위쪽 40%) 되도록 다시 그린다."""
    _, end = fn(sc, where, 0)
    space = CONTENT_B - INNER_T - end
    return fn(sc, where, INNER_T + max(0, int(space * 0.4)))


def fit_font(text, weight, start, max_w):
    size = start
    while size > 40 and text_w(text, font(weight, size)) > max_w:
        size -= 2
    return font(weight, size)


def scene_outro(sc, where, y0=None):
    img, d = new_canvas()
    y = draw_chip(d, sc["chip"], y0)
    y += 60
    y = draw_lines(d, sc["lines"], y, 80, where=where)
    y += 70
    # 사이트 주소 카드
    box_h = 300
    rrect(d, (INNER_L, y, INNER_R, y + box_h), 40, C["accent"])
    fs = fit_font(sc["site"], "extrabold", 96, INNER_R - INNER_L - 70)
    f2 = font("semibold", 52)
    d.text((MIDX, y + 60), "블로그 주소", font=f2, fill="#dbeafe", anchor="mt")
    d.text((MIDX, y + 150), sc["site"], font=fs, fill="#ffffff", anchor="mt")
    y += box_h + 50
    f3 = font("bold", 56)
    for ln in sc["search"]:
        draw_marked(d, MIDX, y, ln, f3, C["text"], C["accent"], align="center",
                    max_w=INNER_R - INNER_L, where=where)
        y += int(56 * 1.3)
    return img, y


# ---------------------------------------------------------------- 자막

CAP_FONT = ("semibold", 50)


def caption_layer(text):
    """투명 RGBA 레이어(1080x1920)에 자막 상자. 확대하지 않고 그대로 얹는다."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if not text:
        return layer
    d = ImageDraw.Draw(layer)
    f = font(*CAP_FONT)
    padx = 26
    lines = wrap(text, f, SAFE[2] - SAFE[0] - padx * 2)
    if len(lines) > 2:
        die("자막이 2줄을 넘습니다: %s" % text)
    lh = 60
    box_h = len(lines) * lh + 16
    top = CAP_TOP + (CAP_BOT - CAP_TOP - box_h) // 2
    rrect(d, (SAFE[0], top, SAFE[2], top + box_h), 22, (26, 26, 26, 225))
    y = top + 8 + lh / 2
    for ln in lines:
        d.text(((SAFE[0] + SAFE[2]) / 2, y), ln, font=f, fill="#ffffff", anchor="mm")
        y += lh
    return layer


def cue_times(data):
    """[(start, end, text, scene_index)]"""
    cues, t = [], 0.0
    for i, sc in enumerate(data["scenes"]):
        dur = float(sc["duration"])
        caps = sc["captions"]
        weights = [max(len(c.replace(" ", "")), 6) for c in caps]
        tot = sum(weights)
        s = t
        for c, wgt in zip(caps, weights):
            e = s + dur * wgt / tot
            cues.append((round(s, 3), round(e, 3), c, i))
            s = e
        t += dur
    return cues


def fmt_ts(sec):
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def write_srt(data, out):
    cues = cue_times(data)
    with open(out, "w", encoding="utf-8") as fh:
        for n, (s, e, txt, _) in enumerate(cues, 1):
            # 다음 자막과 겹치지 않게 끝을 1ms 당긴다
            fh.write("%d\n%s --> %s\n%s\n\n" % (n, fmt_ts(s), fmt_ts(e - 0.001), txt))
    return cues


# ---------------------------------------------------------------- 영상

def zoom_frame(img, scale):
    a = 1.0 / scale
    return img.transform((W, H), Image.AFFINE,
                         (a, 0, CX - CX * a, 0, a, CY - CY * a), resample=Image.BILINEAR)


def build_video(data, scene_imgs, cues, out):
    durs = [float(s["duration"]) for s in data["scenes"]]
    total = sum(durs)
    starts = [sum(durs[:i]) for i in range(len(durs))]
    nframes = int(round(total * FPS))
    cap_layers = {}
    cap_rgb = {}

    def cap_for(t):
        for s, e, txt, _ in cues:
            if s <= t < e:
                return txt
        return cues[-1][2]

    def cap_arrays(txt):
        if txt not in cap_rgb:
            lay = caption_layer(txt)
            arr = np.asarray(lay, dtype=np.float32)
            alpha = arr[..., 3:4] / 255.0
            # 자막이 있는 줄만 계산하도록 범위 저장
            cap_rgb[txt] = (arr[CAP_TOP:CAP_BOT, :, :3], alpha[CAP_TOP:CAP_BOT])
        return cap_rgb[txt]

    def scene_frame(i, t_local):
        p = min(max(t_local / durs[i], 0.0), 1.0)
        return np.asarray(zoom_frame(scene_imgs[i], 1.0 + ZOOM * p), dtype=np.float32)

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-",
        "-f", "lavfi", "-t", "%.3f" % total, "-i", "anullsrc=r=48000:cl=stereo",
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(nframes):
        t = n / FPS
        i = max(k for k in range(len(starts)) if starts[k] <= t + 1e-9)
        frame = scene_frame(i, t - starts[i])
        end = starts[i] + durs[i]
        if i + 1 < len(durs) and t >= end - FADE:
            a = (t - (end - FADE)) / FADE
            nxt = np.asarray(scene_imgs[i + 1], dtype=np.float32)
            frame = frame * (1 - a) + nxt * a
        rgb, alpha = cap_arrays(cap_for(t))
        band = frame[CAP_TOP:CAP_BOT]
        frame[CAP_TOP:CAP_BOT] = band * (1 - alpha) + rgb * alpha
        proc.stdin.write(frame.astype(np.uint8).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        die("ffmpeg 인코딩 실패")


def save_poster(img, out):
    small = img.resize((540, 960), Image.LANCZOS)
    for q in range(88, 40, -4):
        small.save(out, "JPEG", quality=q, optimize=True, progressive=True)
        if os.path.getsize(out) <= 100 * 1024:
            return q
    die("포스터를 100KB 이하로 줄이지 못했습니다")


# ---------------------------------------------------------------- 실행

def process(slug, only):
    d = os.path.join(VIDEOS, slug)
    jpath = os.path.join(d, "video.json")
    if not os.path.isfile(jpath):
        die("video.json 이 없습니다: " + jpath)
    with open(jpath, encoding="utf-8") as fh:
        data = json.load(fh)
    if len(data["scenes"]) != 5:
        die("%s: 장면은 5개여야 합니다" % slug)
    total = sum(float(s["duration"]) for s in data["scenes"])
    if total > 60:
        die("%s: 영상 길이 %.1f초 > 60초" % (slug, total))

    cues = write_srt(data, os.path.join(d, "captions.srt"))
    for c in cues:              # 자막 줄 수 검사
        caption_layer(c[2])
    print("[%s] captions.srt %d개 자막, %.1f초" % (slug, len(cues), total))
    if only == "srt":
        return

    sdir = os.path.join(d, "scenes")
    os.makedirs(sdir, exist_ok=True)
    figs = []
    for i, sc in enumerate(data["scenes"]):
        if sc["type"] == "figure":
            svg = os.path.join(ROOT, sc["svg"])
            if not os.path.isfile(svg):
                die("그림이 없습니다: " + sc["svg"])
            figs.append((svg, os.path.join(sdir, "_fig%02d.png" % (i + 1)), 1120))
    render_svgs(figs)

    scene_imgs = []
    for i, sc in enumerate(data["scenes"]):
        where = "%s 장면 %d" % (slug, i + 1)
        t = sc["type"]
        if t == "hook":
            img, _ = centered(scene_hook, sc, where)
        elif t == "point":
            img, _ = centered(scene_point, sc, where)
        elif t == "figure":
            img, _ = scene_figure(sc, where, os.path.join(sdir, "_fig%02d.png" % (i + 1)))
        elif t == "outro":
            img, _ = centered(scene_outro, sc, where)
        else:
            die("%s: 모르는 장면 종류 %s" % (where, t))
        scene_imgs.append(img)
        first_cap = next(c[2] for c in cues if c[3] == i)
        preview = img.convert("RGBA")
        preview.alpha_composite(caption_layer(first_cap))
        preview.convert("RGB").save(os.path.join(sdir, "%02d.png" % (i + 1)), optimize=True)

    poster = os.path.join(ROOT, "images", "posts", "%s-video-poster.jpg" % slug)
    q = save_poster(scene_imgs[0], poster)
    print("[%s] scenes/01~05.png, 포스터 %dKB (q=%d)" % (slug, os.path.getsize(poster) // 1024, q))
    if only == "scenes":
        return

    out = os.path.join(d, "draft.mp4")
    build_video(data, scene_imgs, cues, out)
    print("[%s] draft.mp4 %.1fMB" % (slug, os.path.getsize(out) / 1e6))


def main():
    ap = argparse.ArgumentParser(description="글 요약 쇼츠 영상 재료 만들기")
    ap.add_argument("slug", help="videos/ 아래 글 slug, 또는 all")
    ap.add_argument("--font-dir", help="Pretendard .otf 폴더(기본: VIDEO_FONT_DIR 또는 videos/fonts)")
    ap.add_argument("--only", choices=["srt", "scenes", "video"], default="video",
                    help="srt: 자막만 / scenes: 자막+장면+포스터 / video: 전부(기본)")
    args = ap.parse_args()
    if args.only != "srt" and not shutil.which("ffmpeg") and args.only == "video":
        die("ffmpeg 를 찾지 못했습니다.")
    setup_fonts(args.font_dir)
    if args.slug == "all":
        slugs = sorted(p for p in os.listdir(VIDEOS)
                       if os.path.isfile(os.path.join(VIDEOS, p, "video.json")))
    else:
        slugs = [args.slug]
    for s in slugs:
        process(s, args.only)


if __name__ == "__main__":
    main()
