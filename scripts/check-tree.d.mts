export declare const EXCLUDED_PREFIXES: readonly string[];
export declare const EXCLUDED_FILES: readonly string[];
export interface Rule {
  rule: string;
  pattern: RegExp;
  except?: readonly string[];
}
export interface Finding {
  file: string;
  line: number;
  rule: string;
}
export declare function rules(hostname: string, userName?: string): Rule[];
export declare function decodeText(buf: Buffer): string | undefined;
export declare function isExcluded(rel: string): boolean;
export declare function listFiles(root: string): string[];
export declare function checkTree(options: { root: string; hostname?: string; userName?: string; files?: string[] }): {
  filesRead: number;
  findings: Finding[];
};
export declare function pngChunks(buf: Buffer): string[] | undefined;
export declare function isScreenshot(rel: string): boolean;
