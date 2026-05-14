/** 灰度是否被判为液滴前景（与预览二值化一致） */
export function isDropletGray(gray: number, threshold: number, dropletIsBright: boolean): boolean {
  return dropletIsBright ? gray > threshold : gray < threshold
}
