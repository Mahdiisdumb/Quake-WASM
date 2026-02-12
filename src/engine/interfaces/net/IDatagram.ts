export default interface IDatagram {
  data: ArrayBuffer;
  cursize: number;
  allowoverflow?: boolean;
  overflowed?: boolean;
}