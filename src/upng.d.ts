declare module "@upng/upng-js" {
  interface ApngFrame {
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    delay: number;
    dispose: number;
    blend: number;
  }

  interface DecodedPng {
    width: number;
    height: number;
    frames: ApngFrame[];
    tabs: {
      acTL?: {
        num_frames: number;
        num_plays: number;
      };
    };
  }

  const UPNG: {
    decode(buffer: ArrayBuffer): DecodedPng;
    toRGBA8(image: DecodedPng): ArrayBuffer[];
  };

  export default UPNG;
}
