/**
 * Next.js turns an imported image into its published address and size. This
 * says so for the package's own type check, which does not run inside Next.
 */
declare module "*.svg" {
  const image: { src: string; width: number; height: number };
  export default image;
}
