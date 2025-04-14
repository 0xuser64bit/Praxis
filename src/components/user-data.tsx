import { useSession } from "@/app/providers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AiActions from "./user-tabs/ai-actions";
import UserTokens from "./user-tabs/user-tokens";
import UserTransactions from "./user-tabs/user-transactions";

export default function UserData() {
  const { session } = useSession();
  return (
    <div className="flex flex-col items-center w-full justify-center gap-4 py-4">
      <Tabs defaultValue="tokens" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-gray-900">
          <TabsTrigger
            className="text-white bg-gray-900 cursor-pointer"
            value="tokens"
          >
            Tokens
          </TabsTrigger>
          <TabsTrigger
            className="text-white bg-gray-900 cursor-pointer"
            value="transactions"
          >
            Transactions
          </TabsTrigger>
          <TabsTrigger
            className="text-white bg-gray-900 cursor-pointer"
            value="ai-actions"
          >
            AI Actions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tokens">
          <UserTokens />
        </TabsContent>
        <TabsContent value="transactions">
          <UserTransactions email={session?.user?.email as string} />
        </TabsContent>
        <TabsContent value="ai-actions">
          <AiActions />
        </TabsContent>
      </Tabs>
    </div>
  );
}
