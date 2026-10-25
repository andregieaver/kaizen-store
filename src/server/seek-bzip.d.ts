/** `seek-bzip` (MIT, pure JavaScript) has no types of its own: the one call the legal sources make (D311, Lovdata's `.tar.bz2`). */
declare module "seek-bzip" {
  const Bunzip: { decode(input: Uint8Array, output?: number, multistream?: boolean): Buffer };
  export default Bunzip;
}
