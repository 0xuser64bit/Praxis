import "./local.css";

export default function AiActions() {
  const aiCommands = [
    {
      command: "/send",
      description: "Send crypto to another wallet",
      example: "/send 0.5 SOL to 8ZJS9...",
    },
    {
      command: "/receive",
      description: "Generate a QR code to receive crypto",
      example: "/receive SOL",
    },
    {
      command: "/swap",
      description: "Swap one token for another",
      example: "/swap 10 USDC to SOL",
    },
    {
      command: "/create-token",
      description: "Create a new SPL token",
      example: "/create-token MyToken 1000000 MTK",
    },
    {
      command: "/stake",
      description: "Stake SOL with a validator",
      example: "/stake 5 SOL with Chorus One",
    },
    {
      command: "/nft-mint",
      description: "Create a new NFT",
      example: "/nft-mint MyArt.jpg 'My First NFT' 'Digital artwork'",
    },
    {
      command: "/transaction",
      description: "View transaction details",
      example: "/transaction 4uzE1DTg...",
    },
    {
      command: "/delegate",
      description: "Delegate token authority",
      example: "/delegate USDC to Dy5J8...",
    },
    {
      command: "/program-deploy",
      description: "Deploy a Solana program",
      example: "/program-deploy myprogram.so",
    },
    {
      command: "/vault-create",
      description: "Create a multi-sig vault",
      example: "/vault-create MyVault [addr1, addr2, addr3] 2",
    },
    {
      command: "/token-metadata",
      description: "Update token metadata",
      example: "/token-metadata MTK set-image logo.png",
    },
    {
      command: "/domain-buy",
      description: "Purchase a .sol domain name",
      example: "/domain-buy mycrypto.sol",
    },
  ];

  return (
    <div className="bg-gray-800 rounded-2xl p-6 space-y-4 my-2">
      <div className="text-center text-gray-400 text-sm">
        These are example of commands but you can write in natural language and
        get the best response.
      </div>
      <div className="flex justify-center overflow-y-auto max-h-[calc(100vh-320px)]">
        <ul className="w-full flex flex-col gap-y-3 overflow-y-scroll">
          {aiCommands.map((cmd) => (
            <li
              key={cmd.command}
              className="bg-gray-700/50 rounded-xl p-4 hover:bg-gray-700 transition cursor-pointer"
            >
              <div className="flex flex-col">
                <span className="text-emerald-400 font-semibold text-lg mb-1">
                  {cmd.command}
                </span>
                <span className="text-gray-300 mb-2">{cmd.description}</span>
                <div className="bg-black/30 p-2 rounded mt-1 text-sm text-gray-400 font-mono">
                  Example: {cmd.example}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
