// Encuentra la carpeta donde está instalado WILLY AI (la que contiene su package.json), subiendo desde donde se
// ejecuta el proceso — hasta 6 niveles, por si acaso. Antes varias rutas /api tenían cada una su propia copia de
// esta misma búsqueda; ahora vive en un solo sitio.
export async function projectRoot(): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      try {
        await fs.access(path.join(dir, "package.json"));
        return dir;
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    return process.cwd();
  } catch {
    return null;
  }
}

// Carpeta para los archivos privados del usuario (avatares, audios de voz, el aviso de actualización...), dentro
// de la instalación de WILLY. Si por algo no se encuentra la instalación, usa la carpeta actual — igual que antes.
export async function privateDataDir(): Promise<string> {
  const path = await import("node:path");
  const root = (await projectRoot()) ?? process.cwd();
  return path.join(root, "datos-privados");
}
