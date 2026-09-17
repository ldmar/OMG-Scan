# 📸 OMG Scan

> **Del clic al PDF perfecto.**

Escáner de documentos **PWA** instalable en Android e iOS. Capturá con la cámara, ajustá bordes, aplicá filtros y exportá a PDF en segundos. Sin ads, sin marcas de agua, sin fricción.

**by [Ohmygoch](https://github.com/tu-usuario)**

---

## ✨ Features

- 📷 **Cámara nativa** con soporte para flash, cámara frontal/trasera y fallback a galería
- 🎯 **Semáforo de calidad en vivo** — te avisa si la foto está oscura, movida o sin contraste
- ✂️ **Crop con esquinas arrastrables** (pointer events unificados mouse/touch)
- 🎨 **5 filtros reales sobre píxeles** — Original, OMG Auto, Color, Escáner, B/N
- 🖼️ **Miniaturas en vivo** de cada filtro, generadas con tu propia imagen
- 👁️ **Comparar** con el original (press & hold)
- 📄 **Multi-página** y PDF en A4 con márgenes automáticos
- 📤 **Descargar o compartir** vía Web Share API
- 📱 **PWA instalable** con safe areas (notch/isla dinámica)
- ⚡ **Cero frameworks**, cero build, un solo HTML
- 🔒 **100% local** — tus documentos nunca salen de tu dispositivo

---

## 🚀 Demo

Subilo a Vercel / Netlify / Cloudflare Pages y abrilo desde el móvil.

```
https://tu-deploy.vercel.app
```

---

## 🧪 Cómo probarlo localmente

La cámara requiere **HTTPS** o **localhost**. Opciones:

```bash
# Opción 1 — Python
python3 -m http.server 8000

# Opción 2 — Node
npx serve .

# Luego abrí:
# http://localhost:8000
```

En el móvil, entrá por la URL del deploy (HTTPS) y:

- **Android/Chrome** → menú ⋮ → Instalar app
- **iOS/Safari** → Compartir → Añadir a pantalla de inicio

---

## 🛠️ Stack

| Capa | Tecnología |
|------|------------|
| UI | HTML + CSS + Vanilla JS |
| Cámara | `getUserMedia` + `MediaStreamTrack.applyConstraints` (torch) |
| Procesado de imagen | Canvas 2D + `ImageData` (filtros píxel a píxel) |
| PDF | `pdf-lib` |
| Compartir | Web Share API (`navigator.share`) |
| Install prompt | `beforeinstallprompt` + Web App Manifest |

---

## 🗺️ Roadmap

- [x] Cámara + captura
- [x] Crop manual con 4 esquinas
- [x] 5 filtros reales
- [x] Multi-página + PDF
- [x] PWA instalable
- [ ] Service Worker (offline-first)
- [ ] Detección automática de bordes (`jscanify`)
- [ ] Pinch-to-zoom en crop
- [ ] OCR offline (`tesseract.js`)
- [ ] Biblioteca local (IndexedDB)
- [ ] Pincel de sombra + borrador mágico
- [ ] Firma digital
- [ ] Modos ID / Libro / Recibo

---

## 📄 Licencia

MIT © Ohmygoch