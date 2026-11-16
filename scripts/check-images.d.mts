export declare const IMAGES_DIR: string;
export declare const IMAGES_README: string;
export declare const BUDGET_BYTES: number;
export declare function imageRefs(text: string): { line: number; alt: string; target: string; caption: string }[];
export declare function checkImages(options: { root: string; files?: string[] }): {
  problems: string[];
  images: number;
  bytes: number;
  uses: Record<string, string[]>;
};
