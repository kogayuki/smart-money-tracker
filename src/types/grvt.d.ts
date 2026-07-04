declare module "@wezzcoetzee/grvt" {
  export enum GrvtEnv {
    TESTNET = "testnet",
    PROD = "prod",
  }

  export interface GrvtClientOptions {
    env: GrvtEnv;
    apiKey?: string;
    tradingAccountId?: string;
    privateKey?: string;
  }

  export interface Ticker {
    mid_price: string;
  }

  export interface OrderResult {
    order_id: string;
  }

  export class GrvtClient {
    constructor(options: GrvtClientOptions);
    fetchTicker(symbol: string): Promise<Ticker>;
    createMarketOrder(
      symbol: string,
      side: string,
      quantity: number,
    ): Promise<OrderResult>;
  }
}
