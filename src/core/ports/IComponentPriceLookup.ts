export interface ComponentPriceQuote {
  spec: string;
  category: string;
  medianPriceBRL: number;
  sampleSize: number;
  sourceUrl: string;
}

export interface IComponentPriceLookup {
  lookup(spec: string, category: string): Promise<ComponentPriceQuote | null>;
  close(): Promise<void>;
}
