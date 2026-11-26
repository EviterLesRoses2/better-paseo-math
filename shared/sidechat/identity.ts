export const SIDECHAT_LABELS = {
  "better-paseo-math.sidechat": "1",
  "paseo-better-sidechat": "1",
} as const;

export function isSidechatAgent(labels?: Readonly<Record<string, string>>): boolean {
  return labels?.["better-paseo-math.sidechat"] === "1" || labels?.["paseo-better-sidechat"] === "1";
}
