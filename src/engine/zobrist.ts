// 해시 키 (두 개의 32비트 정수로 64비트 해시 구성)
import { NSQ } from './constants';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

const rnd = mulberry32(0x57a7 ^ 0x1234abcd);
export const Z_LO = new Int32Array(16 * NSQ);
export const Z_HI = new Int32Array(16 * NSQ);
for (let i = 0; i < 16 * NSQ; i++) {
  Z_LO[i] = rnd();
  Z_HI[i] = rnd();
}
export const Z_SIDE_LO = rnd();
export const Z_SIDE_HI = rnd();
