export default function UserTokens() {
  // Todo: remove mock data
  const walletData = {
    totalBalance: 24567.89,
    tokens: [
      {
        symbol: "SOL",
        name: "Solana",
        balance: 456.78,
        price: 123.45,
        change24h: 3.5,
        holdings: 56289.34,
      },
      {
        symbol: "ETH",
        name: "Ethereum",
        balance: 12.345,
        price: 3456.78,
        change24h: -1.2,
        holdings: 42678.9,
      },
      {
        symbol: "USDC",
        name: "USD Coin",
        balance: 5678.9,
        price: 1.0,
        change24h: 0.1,
        holdings: 5678.9,
      },
    ],
    recentTransactions: [
      {
        type: "Send",
        amount: "0.5 ETH",
        to: "0x123...abc",
        timestamp: "2 hours ago",
      },
      {
        type: "Receive",
        amount: "100 USDC",
        from: "0x456...def",
        timestamp: "5 hours ago",
      },
    ],
  };
  return (
    <>
      {walletData.tokens.map((token) => (
        <div
          key={token.symbol}
          className="bg-gray-800 rounded-2xl p-6 space-y-4 my-2 cursor-pointer hover:bg-gray-700 transition"
        >
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold">{token.symbol}</h3>
            <span
              className={`font-semibold ${
                token.change24h >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {token.change24h >= 0 ? "+" : ""}
              {token.change24h}%
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">Balance</span>
              <span className="font-semibold">
                {token.balance} {token.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Price</span>
              <span className="font-semibold">
                ${token.price.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Total Holdings</span>
              <span className="font-semibold">
                ${token.holdings.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
