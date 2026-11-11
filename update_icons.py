import os
from PIL import Image, ImageEnhance

logo_source = r"C:\Users\mrive\.gemini\antigravity-ide\brain\61d27420-7258-4f9c-b77b-8d297821922d\isaac_vibrant_3d_icon_1788282691601.jpg"
icon_source = r"C:\Users\mrive\.gemini\antigravity-ide\brain\61d27420-7258-4f9c-b77b-8d297821922d\isaac_emblem_vibrant_1788282711613.jpg"

base_frontend = r"c:\AndroidStudioProjects\American POS PC\american-pos-frontend"
base_backend = r"c:\AndroidStudioProjects\American POS PC\american-pos-backend"

print("Opening images...")
img_logo = Image.open(logo_source).convert("RGBA")
img_icon = Image.open(icon_source).convert("RGBA")

# Boost color saturation and contrast slightly for ultra-crisp mobile display
enhancer_color = ImageEnhance.Color(img_icon)
img_icon = enhancer_color.enhance(1.15)
enhancer_contrast = ImageEnhance.Contrast(img_icon)
img_icon = enhancer_contrast.enhance(1.08)

# 1. Update Frontend & Backend Logos
frontend_src_logo = os.path.join(base_frontend, "src", "assets", "logo.png")
frontend_pub_logo = os.path.join(base_frontend, "public", "logo.png")
frontend_pub_icon = os.path.join(base_frontend, "public", "assets", "icon.png")
backend_pub_logo = os.path.join(base_backend, "public", "logo.png")

img_logo.save(frontend_src_logo, "PNG", quality=100)
img_logo.save(frontend_pub_logo, "PNG", quality=100)
if os.path.exists(os.path.dirname(backend_pub_logo)):
    img_logo.save(backend_pub_logo, "PNG", quality=100)

img_icon.save(frontend_pub_icon, "PNG", quality=100)
print("Updated frontend and backend web logos & icons.")

# 2. Android Mipmap Sizes (ic_launcher, ic_launcher_round, ic_launcher_foreground)
android_res = os.path.join(base_frontend, "android", "app", "src", "main", "res")

mipmap_sizes = {
    "mipmap-mdpi": (48, 48),
    "mipmap-hdpi": (72, 72),
    "mipmap-xhdpi": (96, 96),
    "mipmap-xxhdpi": (144, 144),
    "mipmap-xxxhdpi": (192, 192),
}

for folder, size in mipmap_sizes.items():
    dir_path = os.path.join(android_res, folder)
    os.makedirs(dir_path, exist_ok=True)
    
    resized_icon = img_icon.resize(size, Image.LANCZOS)
    
    resized_icon.save(os.path.join(dir_path, "ic_launcher.png"), "PNG")
    resized_icon.save(os.path.join(dir_path, "ic_launcher_round.png"), "PNG")
    resized_icon.save(os.path.join(dir_path, "ic_launcher_foreground.png"), "PNG")
    print(f"Updated {folder} ({size[0]}x{size[1]}) with vibrant 3D icon")

# 3. Splash Screens
splash_dirs = [
    ("drawable", (480, 800)),
    ("drawable-port-mdpi", (320, 480)),
    ("drawable-port-hdpi", (480, 800)),
    ("drawable-port-xhdpi", (720, 1280)),
    ("drawable-port-xxhdpi", (960, 1600)),
    ("drawable-port-xxxhdpi", (1280, 1920)),
    ("drawable-land-mdpi", (480, 320)),
    ("drawable-land-hdpi", (800, 480)),
    ("drawable-land-xhdpi", (1280, 720)),
    ("drawable-land-xxhdpi", (1600, 960)),
    ("drawable-land-xxxhdpi", (1920, 1280)),
]

for folder, size in splash_dirs:
    dir_path = os.path.join(android_res, folder)
    if os.path.exists(dir_path):
        # Radiant clean dark slate with vibrant 3D logo
        splash_bg = Image.new("RGBA", size, (15, 23, 42, 255))
        target_h = int(min(size) * 0.50)
        aspect = img_logo.width / img_logo.height
        target_w = int(target_h * aspect)
        scaled_logo = img_logo.resize((target_w, target_h), Image.LANCZOS)
        
        pos_x = (size[0] - target_w) // 2
        pos_y = (size[1] - target_h) // 2
        splash_bg.paste(scaled_logo, (pos_x, pos_y), scaled_logo)
        
        splash_bg.save(os.path.join(dir_path, "splash.png"), "PNG")
        print(f"Updated splash in {folder}")

print("All Android assets upgraded with ultra-vibrant, bright 3D visuals successfully!")
