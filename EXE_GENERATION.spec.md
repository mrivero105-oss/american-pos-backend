# Generación de Ejecutable (.exe) para American POS

Este documento detalla los pasos para compilar y empaquetar el sistema American POS (Backend + Frontend) en un único archivo ejecutable para Windows.

## 1. Prerrequisitos

Asegúrate de tener instalado:
- **Node.js**: [Descargar aquí](https://nodejs.org/)
- **Git Bash** o **PowerShell**

## 2. Preparación

Los archivos del frontend ya han sido copiados a la carpeta `public` del backend. Si realizas cambios en el frontend, recuerda volver a copiarlos:

```powershell
# Desde la carpeta raíz del proyecto
Copy-Item -Path ".\american-pos-frontend\*" -Destination ".\american-pos-backend\public" -Recurse -Force
```

## 3. Instalación de Dependencias

Navega a la carpeta del backend e instala las dependencias necesarias (incluyendo Electron):

```powershell
cd american-pos-backend
npm install
```

## 4. Prueba Local (Modo Desarrollo)

Antes de empaquetar, puedes probar que la aplicación Electron funciona correctamente:

```powershell
npm run electron:start
```

Esto abrirá una ventana de aplicación de escritorio. Deberías ver:
1. El icono de la aplicación en la barra de tareas.
2. La interfaz de American POS cargando correctamente.
3. La base de datos (`db.json`) se guardará en `%APPDATA%\American POS` (persistencia real).

## 5. Generación del .exe

Para crear el instalador portable:

```powershell
npm run dist
```

Este proceso puede tardar unos minutos la primera vez. Al finalizar, encontrarás el instalador en:
`american-pos-backend/dist/American POS Setup 1.0.0.exe`

## 6. Distribución

Simplemente copia y ejecuta el archivo `.exe` generado en cualquier computadora con Windows.
- No requiere instalar Node.js ni bases de datos externas.
- Todos los datos se guardan localmente en la carpeta de usuario.

---

### Solución de Problemas

**Error: Icono no encontrado**
Si el build falla por el icono, asegúrate de que exista un archivo `.png` o `.ico` en `american-pos-backend/public/assets/icon.png`.

**Error: Puertos ocupados**
La aplicación intenta usar el puerto 3000 internamente. Si falla, asegúrate de que no haya otros servicios corriendo en ese puerto.
