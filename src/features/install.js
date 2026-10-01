// src/features/install.js — chip de instalación PWA (Android + iOS).

import { $ } from "../utils.js";
import { showToast } from "../ui.js";

export function initInstall() {
  const installChip = $("#btnInstall");
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone;

  if (isIOS && !isStandalone) {
    installChip.classList.add("show");
    installChip.textContent = "📲 Cómo instalar";
    installChip.addEventListener("click", () => {
      $("#modalInstallIos").classList.add("show");
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__omgInstallPrompt = e;
    if (!isStandalone) installChip.classList.add("show");
  });

  installChip.addEventListener("click", async () => {
    if (isIOS) { $("#modalInstallIos").classList.add("show"); return; }
    const p = window.__omgInstallPrompt;
    if (!p) { showToast("Buscá 'Añadir a pantalla de inicio' en el menú"); return; }
    try {
      p.prompt();
      const res = await p.userChoice;
      if (res.outcome === "accepted") showToast("¡Instalada! 🎉");
      window.__omgInstallPrompt = null;
    } catch (_) {}
  });

  window.addEventListener("appinstalled", () => {
    installChip.classList.remove("show");
    showToast("OMG Scan instalada 🎉");
  });
}
