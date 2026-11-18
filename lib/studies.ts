export const studies = [
  { id: "fox", name: "Red fox", clip: "Run cycle", frames: 32, color: "#f26534", wash: "#f6e8d8" },
  { id: "heron", name: "Blue heron", clip: "Flight cycle", frames: 40, color: "#5979b5", wash: "#e0e8f4" },
  { id: "fish", name: "Jade koi", clip: "Swim cycle", frames: 48, color: "#398f80", wash: "#deede5" }
] as const;
export type Study = typeof studies[number];
