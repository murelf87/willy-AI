import { useRef, useState } from "react";
import { prepareImage, type PreparedImage } from "@/lib/vision";

/** Imágenes pegadas, arrastradas o subidas a un cuadro de chat: se reducen y se guardan hasta enviar. */
export function useImages(notify: (message: string) => void, max = 3) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  // Cuenta las imágenes aceptadas aunque se peguen varias seguidas antes de que React actualice el estado.
  const count = useRef(0);

  const add = async (files: File[]) => {
    for (const file of files) {
      if (count.current >= max) {
        notify(`Puedes adjuntar hasta ${max} imágenes por mensaje.`);
        break;
      }
      count.current += 1;
      try {
        const prepared = await prepareImage(file, `imagen-${count.current}.jpg`);
        setImages((previous) => [...previous, prepared]);
      } catch (error) {
        count.current -= 1;
        notify(`No pude leer esa imagen: ${error instanceof Error ? error.message : "formato no compatible"}.`);
      }
    }
  };

  const remove = (image: PreparedImage) => {
    count.current = Math.max(0, count.current - 1);
    setImages((previous) => previous.filter((entry) => entry !== image));
  };

  const clear = () => {
    count.current = 0;
    setImages([]);
  };

  return { images, add, remove, clear };
}
