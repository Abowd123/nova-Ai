import { DEFAULT_ASSISTANT_AVATAR } from "@/lib/models";
import { cn } from "@/lib/utils";

export function AssistantAvatar({ avatar, className }: { avatar: string; className?: string }) {
  const isImage = avatar.startsWith("data:image/");
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-secondary text-2xl", className)}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="size-full object-cover" />
      ) : (
        avatar || DEFAULT_ASSISTANT_AVATAR
      )}
    </span>
  );
}
