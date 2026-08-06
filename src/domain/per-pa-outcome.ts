export type PerPaOutcomeVector<Category extends string = string> = Readonly<
  Record<Category, number>
>;
