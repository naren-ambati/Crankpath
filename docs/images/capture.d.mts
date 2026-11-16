export interface Cmd {
  cmd: string;
  check: (c: { exit: number; output: string }) => string[];
}
export interface Scenario {
  id: string;
  title: string;
  caption: string;
  alt: string;
  commands: Cmd[];
  action?: string;
  mermaid?: boolean;
}
export declare const SCENARIOS: Scenario[];
export declare function scrub(text: string): string;
