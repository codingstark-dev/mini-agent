export type NativeRoleName =
  | "super-planner"
  | "super-executor"
  | "super-verifier"
  | "super-explorer"
  | "super-oracle";

export interface NativeRole {
  name: NativeRoleName;
  description: string;
  instructions: string;
}
