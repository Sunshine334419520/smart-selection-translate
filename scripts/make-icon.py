"""Generate assets/icon-180.png from the same shapes as icon.svg."""

from PIL import Image, ImageDraw, ImageFont

SIZE = 180
RADIUS = 40
SS = 4  # supersample for smooth edges

canvas = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))

# Diagonal gradient #2563eb -> #60a5fa, clipped to a rounded square.
grad = Image.new("RGB", (SIZE * SS, SIZE * SS))
px = grad.load()
start = (0x25, 0x63, 0xEB)
end = (0x60, 0xA5, 0xFA)
total = (SIZE * SS - 1) * 2
for y in range(SIZE * SS):
    for x in range(SIZE * SS):
        t = (x + y) / total
        px[x, y] = tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(3))

mask = Image.new("L", (SIZE * SS, SIZE * SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE * SS - 1, SIZE * SS - 1], radius=RADIUS * SS, fill=255)

canvas.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(canvas)


def font(paths, size):
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


latin = font([r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\segoeuib.ttf"], 92 * SS)
cjk = font([r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"], 74 * SS)

white = (255, 255, 255, 255)


def centered(text, fnt, box):
    left, top, right, bottom = box
    l, t, r, b = draw.textbbox((0, 0), text, font=fnt)
    w, h = r - l, b - t
    x = left + (right - left - w) / 2 - l
    y = top + (bottom - top - h) / 2 - t
    draw.text((x, y), text, font=fnt, fill=white)


centered("A", latin, (10 * SS, 20 * SS, 86 * SS, 160 * SS))
centered("文", cjk, (96 * SS, 20 * SS, 170 * SS, 160 * SS))

canvas.resize((SIZE, SIZE), Image.LANCZOS).save("assets/icon-180.png")
print("wrote assets/icon-180.png")
