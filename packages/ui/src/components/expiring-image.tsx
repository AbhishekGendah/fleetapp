import { cn } from "../lib/utils";

/**
 * An image shown through a link that expires in minutes, like every stored
 * file (rule 8). A plain img: there is nothing for an image optimiser to
 * cache, and the link would be useless to it after it expires.
 */
export function ExpiringImage(props: {
  src: string;
  alt: string;
  className?: string;
}): React.JSX.Element {
  return <img src={props.src} alt={props.alt} className={cn("object-contain", props.className)} />;
}
