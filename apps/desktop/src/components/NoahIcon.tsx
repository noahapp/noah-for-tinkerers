// Canonical brand mark — auto-synced from /brand/noah-icon.svg via
// /brand/sync.sh. Do not replace with a hand-edited PNG/SVG.
import noahIcon from "../assets/noah-icon.svg";

interface NoahIconProps {
  className?: string;
  alt?: string;
}

export function NoahIcon({
  className = "w-8 h-8 rounded-lg",
  alt = "Noah icon",
}: NoahIconProps) {
  return <img src={noahIcon} alt={alt} className={className} />;
}
