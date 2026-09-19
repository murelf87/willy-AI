import { useProfile } from "@/lib/profile";

/** Foto de perfil local; si no hay foto, muestra la inicial. */
export function UserAvatar({ size = 36, className = "" }: { size?: number; className?: string }) {
  const [profile] = useProfile();
  const initial = (profile.name.trim()[0] ?? "A").toUpperCase();

  if (profile.avatar) {
    return (
      <img
        src={profile.avatar}
        alt={profile.name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground ${className}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
