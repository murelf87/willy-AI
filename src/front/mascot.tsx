// Mascota de WILLY (dibujo propio en SVG, sin imágenes de fuera). Sustituible por la ilustración definitiva del dueño:
// basta con poner el archivo en public/mascota.png y cambiar `WillyMascot` para que lo cargue.
import { useId } from "react";

export function WillyMascot({ className = "" }: { className?: string }) {
  // Los degradados llevan un id único por instancia: con dos mascotas en la página (Inicio y Chats) los ids repetidos
  // hacían que una de ellas perdiera el visor y los ojos.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `wm-${name}-${uid}`;
  const url = (name: string) => `url(#${id(name)})`;
  return (
    <svg viewBox="0 0 240 200" className={className} role="img" aria-label="WILLY, tu asistente" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={id("glow")} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="oklch(0.88 0.08 285)" stopOpacity="0.9" />
          <stop offset="70%" stopColor="oklch(0.9 0.06 285)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="oklch(0.9 0.06 285)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("head")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dfe3ff" />
        </linearGradient>
        <linearGradient id={id("visor")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b3f9c" />
          <stop offset="100%" stopColor="#1f2358" />
        </linearGradient>
        <linearGradient id={id("ear")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c6cf7" />
          <stop offset="100%" stopColor="#5b4be0" />
        </linearGradient>
        <radialGradient id={id("eye")} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#8fd8ff" />
          <stop offset="100%" stopColor="#4aa9ff" />
        </radialGradient>
      </defs>
      <ellipse cx="120" cy="105" rx="118" ry="88" fill={url("glow")} />
      {/* antena */}
      <rect x="116" y="26" width="8" height="22" rx="4" fill="#6d5df6" />
      <circle cx="120" cy="22" r="9" fill="#8b7cf9" />
      <circle cx="117" cy="19" r="3" fill="#ffffff" opacity="0.8" />
      {/* orejas */}
      <rect x="22" y="80" width="22" height="46" rx="11" fill={url("ear")} />
      <rect x="196" y="80" width="22" height="46" rx="11" fill={url("ear")} />
      {/* cabeza */}
      <rect x="40" y="44" width="160" height="124" rx="46" fill={url("head")} stroke="#c9cef7" strokeWidth="2" />
      {/* visor */}
      <rect x="58" y="70" width="124" height="70" rx="30" fill={url("visor")} />
      <rect x="66" y="76" width="108" height="20" rx="10" fill="#ffffff" opacity="0.08" />
      {/* ojos */}
      <circle cx="94" cy="105" r="13" fill={url("eye")} />
      <circle cx="146" cy="105" r="13" fill={url("eye")} />
      <circle cx="90" cy="100" r="4" fill="#ffffff" />
      <circle cx="142" cy="100" r="4" fill="#ffffff" />
      {/* sonrisa */}
      <path d="M104 124 Q120 136 136 124" stroke="#8fd8ff" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* cuello */}
      <rect x="98" y="166" width="44" height="12" rx="6" fill="#c9cef7" />
      <rect x="72" y="176" width="96" height="18" rx="9" fill="#e6e8ff" />
    </svg>
  );
}
