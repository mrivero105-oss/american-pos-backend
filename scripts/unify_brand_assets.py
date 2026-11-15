import os
import shutil
import tempfile
from PIL import Image

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, 'american-pos-frontend')
BACKEND_DIR = os.path.join(PROJECT_ROOT, 'american-pos-backend')

def safe_save_png(img, dest_path):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(suffix='.png', dir=os.path.dirname(dest_path))
    os.close(temp_fd)
    img.save(temp_path, "PNG", optimize=True)
    try:
        os.replace(temp_path, dest_path)
    except Exception:
        if os.path.exists(dest_path):
            try: os.remove(dest_path)
            except Exception: pass
        shutil.move(temp_path, dest_path)

# Fuente oficial del NUEVO emblema con circuitos (isaac-emblem.png / isaac-emblem-dark.png)
# NUNCA usar la "I" antigua de neón
source_emblem = os.path.join(FRONTEND_DIR, 'src', 'assets', 'isaac-emblem.png')
source_emblem_dark = os.path.join(FRONTEND_DIR, 'src', 'assets', 'isaac-emblem-dark.png')

print("✔ Cargando el NUEVO emblema oficial con circuitos...")
img_emblem = Image.open(source_emblem).convert("RGBA")

# Versión 512x512 y 192x192 generadas con Lanczos centradas para máxima nitidez
size_512 = (512, 512)
img_512 = Image.new("RGBA", size_512, (0, 0, 0, 0))
aspect = img_emblem.width / img_emblem.height
target_h = int(512 * 0.92) # 92% con margen estético
target_w = int(target_h * aspect)
scaled = img_emblem.resize((target_w, target_h), Image.Resampling.LANCZOS)
offset_x = (512 - target_w) // 2
offset_y = (512 - target_h) // 2
img_512.paste(scaled, (offset_x, offset_y), scaled)

img_192 = img_512.resize((192, 192), Image.Resampling.LANCZOS)

# 1. Frontend
for p in [
    os.path.join(FRONTEND_DIR, 'public', 'assets', 'icon.png'),
    os.path.join(FRONTEND_DIR, 'public', 'logo.png'),
    os.path.join(FRONTEND_DIR, 'public', 'icon-512x512.png'),
    os.path.join(FRONTEND_DIR, 'src', 'assets', 'logo.png'),
    os.path.join(FRONTEND_DIR, 'public', 'isaac-emblem.png'),
]:
    safe_save_png(img_512, p)
    print(f"✔ Frontend actualizado: {os.path.basename(p)}")

safe_save_png(img_192, os.path.join(FRONTEND_DIR, 'public', 'icon-192x192.png'))

# 2. Backend
for p in [
    os.path.join(BACKEND_DIR, 'public', 'assets', 'icon.png'),
    os.path.join(BACKEND_DIR, 'public', 'logo.png'),
    os.path.join(BACKEND_DIR, 'public', 'icon-512x512.png'),
    os.path.join(BACKEND_DIR, 'public', 'isaac-emblem.png'),
]:
    safe_save_png(img_512, p)
    print(f"✔ Backend actualizado: {os.path.basename(p)}")

safe_save_png(img_192, os.path.join(BACKEND_DIR, 'public', 'icon-192x192.png'))

# 3. Sincronizar logotipos horizontales oficiales
for brand in ['isaac-emblem-dark.png', 'isaac-logo-horizontal.png', 'isaac-logo-horizontal-dark.png']:
    src = os.path.join(FRONTEND_DIR, 'src', 'assets', brand)
    if os.path.exists(src):
        shutil.copyfile(src, os.path.join(FRONTEND_DIR, 'public', brand))
        shutil.copyfile(src, os.path.join(BACKEND_DIR, 'public', brand))
        print(f"✔ Sincronizado {brand}")

print("\n🎉 Nuevo emblema circular oficial con circuitos aplicado en todos los destinos.")
